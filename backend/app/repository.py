"""Tenant-scoped data access.

Every query goes through `_scoped()`, which filters on org_id. Callers can't
build a repository without an org, so cross-tenant reads are impossible by
construction. Records from another org are indistinguishable from missing
ones (NotFound -> 404), so IDs don't leak across restaurants.
"""

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.errors import NotFound, VersionConflict
from app.models import Recipe, utcnow
from app.schemas import RecipeIn, RecipeUpdate

MAX_LIMIT = 100


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def build_search_text(data: RecipeIn) -> str:
    parts = [data.title, *data.tags, *(line.name for line in data.ingredients)]
    return " | ".join(p.lower() for p in parts)


def build_tags_index(tags: list[str]) -> str:
    # "|a|b|" lets us match a whole tag with LIKE '%|a|%'.
    return "|" + "|".join(tags) + "|" if tags else ""


def _apply(recipe: Recipe, data: RecipeIn) -> None:
    recipe.title = data.title
    recipe.tags = data.tags
    recipe.yield_quantity = data.yield_.quantity
    recipe.yield_unit = data.yield_.unit
    recipe.yield_portions = data.yield_.portions
    recipe.ingredients = [line.model_dump() for line in data.ingredients]
    recipe.steps = data.steps
    recipe.search_text = build_search_text(data)
    recipe.tags_index = build_tags_index(data.tags)


class RecipeRepository:
    def __init__(self, session: Session, org_id: str):
        if not org_id:
            raise ValueError("org_id is required")
        self.session = session
        self.org_id = org_id

    def _scoped(self, include_deleted: bool = False) -> Select[tuple[Recipe]]:
        stmt = select(Recipe).where(Recipe.org_id == self.org_id)
        if not include_deleted:
            stmt = stmt.where(Recipe.deleted_at.is_(None))
        return stmt

    def list(
        self, q: str | None = None, tag: str | None = None, limit: int = 20, offset: int = 0
    ) -> tuple[list[Recipe], int]:
        limit = max(1, min(limit, MAX_LIMIT))
        offset = max(0, offset)
        stmt = self._scoped()
        if q and q.strip():
            for term in q.lower().split():
                stmt = stmt.where(Recipe.search_text.like(f"%{_escape_like(term)}%", escape="\\"))
        if tag and tag.strip():
            needle = f"%|{_escape_like(tag.strip().lower())}|%"
            stmt = stmt.where(Recipe.tags_index.like(needle, escape="\\"))

        total = self.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        rows = self.session.scalars(
            stmt.order_by(func.lower(Recipe.title), Recipe.id).limit(limit).offset(offset)
        ).all()
        return list(rows), total

    def get(self, recipe_id: int, include_deleted: bool = False) -> Recipe:
        recipe = self.session.scalar(self._scoped(include_deleted).where(Recipe.id == recipe_id))
        if recipe is None:
            raise NotFound(f"Recipe {recipe_id} not found")
        return recipe

    def create(self, data: RecipeIn) -> Recipe:
        recipe = Recipe(org_id=self.org_id)
        _apply(recipe, data)
        self.session.add(recipe)
        self.session.commit()
        return recipe

    def update(self, recipe_id: int, data: RecipeUpdate) -> Recipe:
        recipe = self.get(recipe_id)
        if recipe.version != data.version:
            raise VersionConflict(
                "Recipe was changed by someone else; reload and reapply your edits",
                current_version=recipe.version,
            )
        _apply(recipe, data)
        recipe.updated_at = utcnow()
        return self._commit_or_conflict(recipe)

    def delete(self, recipe_id: int) -> None:
        recipe = self.get(recipe_id)
        recipe.deleted_at = utcnow()
        self._commit_or_conflict(recipe)

    def restore(self, recipe_id: int) -> Recipe:
        recipe = self.get(recipe_id, include_deleted=True)
        if recipe.deleted_at is None:
            raise NotFound(f"Recipe {recipe_id} is not deleted")
        recipe.deleted_at = None
        recipe.updated_at = utcnow()
        return self._commit_or_conflict(recipe)

    def _commit_or_conflict(self, recipe: Recipe) -> Recipe:
        try:
            self.session.commit()
        except StaleDataError:
            # Lost a race with a concurrent write after our version check.
            self.session.rollback()
            raise VersionConflict("Recipe was changed by someone else; reload and retry") from None
        return recipe

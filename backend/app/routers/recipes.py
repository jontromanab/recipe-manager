from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.auth import CurrentUser, EditorUser, User
from app.db import get_session
from app.models import Recipe
from app.repository import MAX_LIMIT, RecipeRepository
from app.scaling import resolve_factor, scale_recipe
from app.schemas import RecipeIn, RecipeOut, RecipePage, RecipeSummary, RecipeUpdate

router = APIRouter(prefix="/recipes", tags=["recipes"])

SessionDep = Annotated[Session, Depends(get_session)]


def _repo(session: Session, user: User) -> RecipeRepository:
    return RecipeRepository(session, user.org_id)


def _to_out(recipe: Recipe) -> RecipeOut:
    return RecipeOut.model_validate(
        {
            "id": recipe.id,
            "title": recipe.title,
            "tags": recipe.tags,
            "yield": {
                "quantity": recipe.yield_quantity,
                "unit": recipe.yield_unit,
                "portions": recipe.yield_portions,
            },
            "ingredients": recipe.ingredients,
            "steps": recipe.steps,
            "version": recipe.version,
            "created_at": recipe.created_at,
            "updated_at": recipe.updated_at,
        }
    )


def _to_summary(recipe: Recipe) -> RecipeSummary:
    return RecipeSummary.model_validate(_to_out(recipe).model_dump(by_alias=True))


@router.get("", response_model=RecipePage)
def list_recipes(
    user: CurrentUser,
    session: SessionDep,
    q: Annotated[str | None, Query(max_length=100, description="Matches title, tags, ingredients")] = None,
    tag: Annotated[str | None, Query(max_length=40)] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> RecipePage:
    items, total = _repo(session, user).list(q=q, tag=tag, limit=limit, offset=offset)
    return RecipePage(items=[_to_summary(r) for r in items], total=total, limit=limit, offset=offset)


@router.post("", response_model=RecipeOut, status_code=status.HTTP_201_CREATED)
def create_recipe(data: RecipeIn, user: EditorUser, session: SessionDep) -> RecipeOut:
    return _to_out(_repo(session, user).create(data))


@router.get("/{recipe_id}", response_model=RecipeOut)
def get_recipe(
    recipe_id: int,
    user: CurrentUser,
    session: SessionDep,
    scale: Annotated[float | None, Query(gt=0, description="Multiply all quantities")] = None,
    target_yield: Annotated[float | None, Query(gt=0, description="Desired yield, in the recipe's yield unit")] = None,
) -> RecipeOut:
    recipe = _to_out(_repo(session, user).get(recipe_id))
    factor = resolve_factor(recipe.yield_.quantity, scale, target_yield)
    return scale_recipe(recipe, factor)


@router.put("/{recipe_id}", response_model=RecipeOut)
def update_recipe(recipe_id: int, data: RecipeUpdate, user: EditorUser, session: SessionDep) -> RecipeOut:
    return _to_out(_repo(session, user).update(recipe_id, data))


@router.delete("/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recipe(recipe_id: int, user: EditorUser, session: SessionDep) -> Response:
    _repo(session, user).delete(recipe_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{recipe_id}/restore", response_model=RecipeOut)
def restore_recipe(recipe_id: int, user: EditorUser, session: SessionDep) -> RecipeOut:
    return _to_out(_repo(session, user).restore(recipe_id))

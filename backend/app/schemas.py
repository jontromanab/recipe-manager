from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_TAGS = 20
MAX_INGREDIENTS = 200
MAX_STEPS = 100
MAX_STEP_LENGTH = 2000


class _Base(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, validate_by_name=True, validate_by_alias=True)


class IngredientLine(_Base):
    quantity: float | None = Field(default=None, gt=0, description="Omit for 'to taste'")
    unit: str | None = Field(default=None, max_length=32)
    name: str = Field(min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=200, description="Prep note, e.g. 'finely diced'")

    @field_validator("unit", "note")
    @classmethod
    def blank_to_none(cls, v: str | None) -> str | None:
        return v or None


class Yield(_Base):
    quantity: float = Field(gt=0)
    unit: str = Field(min_length=1, max_length=32)
    portions: float | None = Field(default=None, gt=0)


class RecipeIn(_Base):
    title: str = Field(min_length=1, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=MAX_TAGS)
    yield_: Yield = Field(alias="yield")
    ingredients: list[IngredientLine] = Field(min_length=1, max_length=MAX_INGREDIENTS)
    steps: list[str] = Field(min_length=1, max_length=MAX_STEPS)

    @field_validator("tags")
    @classmethod
    def normalise_tags(cls, tags: list[str]) -> list[str]:
        seen: list[str] = []
        for tag in tags:
            t = tag.strip().lower()
            if t and t not in seen:
                if len(t) > 40:
                    raise ValueError("tags must be at most 40 characters")
                seen.append(t)
        return seen

    @field_validator("steps")
    @classmethod
    def steps_not_blank(cls, steps: list[str]) -> list[str]:
        if any(not s for s in steps):
            raise ValueError("steps must not be blank")
        if any(len(s) > MAX_STEP_LENGTH for s in steps):
            raise ValueError(f"each step must be at most {MAX_STEP_LENGTH} characters")
        return steps


class RecipeUpdate(RecipeIn):
    version: int = Field(ge=1, description="Version the client last saw; stale -> 409")


class RecipeSummary(_Base):
    model_config = ConfigDict(from_attributes=True, serialize_by_alias=True)

    id: int
    title: str
    tags: list[str]
    yield_: Yield = Field(alias="yield")
    version: int
    updated_at: datetime


class RecipeOut(RecipeSummary):
    ingredients: list[IngredientLine]
    steps: list[str]
    created_at: datetime
    scale_factor: float = 1.0


class RecipePage(_Base):
    items: list[RecipeSummary]
    total: int
    limit: int
    offset: int


class Me(_Base):
    id: str
    name: str
    org_id: str
    org_name: str
    role: str

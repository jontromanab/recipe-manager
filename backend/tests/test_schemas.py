import pytest
from pydantic import ValidationError

from app.schemas import RecipeIn, RecipeUpdate
from tests.conftest import recipe_payload


def test_valid_payload_parses_yield_alias():
    r = RecipeIn.model_validate(recipe_payload())
    assert r.yield_.quantity == 4


def test_tags_trimmed_lowercased_deduped():
    r = RecipeIn.model_validate(recipe_payload(tags=[" Soup ", "soup", "BASE", ""]))
    assert r.tags == ["soup", "base"]


def test_title_whitespace_stripped():
    assert RecipeIn.model_validate(recipe_payload(title="  Stock  ")).title == "Stock"


def test_blank_unit_becomes_none():
    r = RecipeIn.model_validate(recipe_payload(ingredients=[{"quantity": 1, "unit": " ", "name": "egg"}]))
    assert r.ingredients[0].unit is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": ""},
        {"title": "   "},
        {"title": "x" * 201},
        {"ingredients": []},
        {"steps": []},
        {"steps": ["ok", "  "]},
        {"steps": ["x" * 2001]},
        {"ingredients": [{"quantity": -1, "unit": "g", "name": "salt"}]},
        {"ingredients": [{"quantity": 0, "unit": "g", "name": "salt"}]},
        {"ingredients": [{"quantity": 1, "unit": "g", "name": ""}]},
        {"yield": {"quantity": 0, "unit": "quart"}},
        {"yield": {"quantity": 1, "unit": ""}},
        {"yield": {"quantity": 1, "unit": "quart", "portions": -2}},
        {"tags": ["t" * 41]},
        {"tags": [f"t{i}" for i in range(21)]},
    ],
    ids=lambda o: next(iter(o)),
)
def test_invalid_payloads_rejected(overrides):
    with pytest.raises(ValidationError):
        RecipeIn.model_validate(recipe_payload(**overrides))


def test_missing_yield_rejected():
    body = recipe_payload()
    del body["yield"]
    with pytest.raises(ValidationError):
        RecipeIn.model_validate(body)


def test_update_requires_version():
    with pytest.raises(ValidationError):
        RecipeUpdate.model_validate(recipe_payload())
    assert RecipeUpdate.model_validate(recipe_payload(version=3)).version == 3

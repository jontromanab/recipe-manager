import pytest

from app.errors import InvalidInput
from app.scaling import resolve_factor, scale_quantity, scale_recipe
from app.schemas import RecipeOut


def make_recipe(portions=8.0) -> RecipeOut:
    return RecipeOut.model_validate(
        {
            "id": 1,
            "title": "Soup",
            "tags": [],
            "yield": {"quantity": 2, "unit": "quart", "portions": portions},
            "ingredients": [
                {"quantity": 0.1, "unit": "cup", "name": "oil"},
                {"quantity": 3, "unit": "each", "name": "onion"},
                {"name": "salt", "note": "to taste"},
            ],
            "steps": ["Cook."],
            "version": 1,
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
    )


class TestResolveFactor:
    def test_defaults_to_one(self):
        assert resolve_factor(4, None, None) == 1.0

    def test_scale_passes_through(self):
        assert resolve_factor(4, 2.5, None) == 2.5

    def test_target_yield_divides_by_base(self):
        assert resolve_factor(4, None, 10) == 2.5

    def test_both_rejected(self):
        with pytest.raises(InvalidInput):
            resolve_factor(4, 2, 8)

    @pytest.mark.parametrize("scale", [0.001, 101, 1000])
    def test_out_of_range_rejected(self, scale):
        with pytest.raises(InvalidInput):
            resolve_factor(4, scale, None)

    def test_target_yield_out_of_range_rejected(self):
        with pytest.raises(InvalidInput):
            resolve_factor(1, None, 500)


class TestScaleQuantity:
    def test_none_stays_none(self):
        assert scale_quantity(None, 3) is None

    def test_float_noise_rounded(self):
        assert scale_quantity(0.1, 3) == 0.3

    def test_halving(self):
        assert scale_quantity(3, 0.5) == 1.5


class TestScaleRecipe:
    def test_scales_ingredients_and_yield(self):
        out = scale_recipe(make_recipe(), 2)
        assert [i.quantity for i in out.ingredients] == [0.2, 6, None]
        assert out.yield_.quantity == 4
        assert out.yield_.portions == 16
        assert out.scale_factor == 2

    def test_units_not_converted(self):
        out = scale_recipe(make_recipe(), 10)
        assert out.ingredients[0].unit == "cup"
        assert out.yield_.unit == "quart"

    def test_missing_portions_ok(self):
        out = scale_recipe(make_recipe(portions=None), 3)
        assert out.yield_.portions is None

    def test_does_not_mutate_input(self):
        original = make_recipe()
        scale_recipe(original, 2)
        assert original.ingredients[1].quantity == 3
        assert original.scale_factor == 1.0

    def test_identity_factor_returns_same(self):
        r = make_recipe()
        assert scale_recipe(r, 1.0) is r

"""Yield scaling: pure functions, no I/O.

Quantities are multiplied, never converted between units (2 cups x2 = 4 cups,
not 1 quart). Unit conversion is a deliberate non-goal for this skeleton.
"""

from app.errors import InvalidInput
from app.schemas import RecipeOut

MAX_FACTOR = 100.0
MIN_FACTOR = 0.01


def resolve_factor(base_yield: float, scale: float | None, target_yield: float | None) -> float:
    """Turn the request's `scale` or `target_yield` into a multiplier."""
    if scale is not None and target_yield is not None:
        raise InvalidInput("Use either scale or target_yield, not both")
    if scale is None and target_yield is None:
        return 1.0
    factor = scale if scale is not None else target_yield / base_yield  # type: ignore[operator]
    if not (MIN_FACTOR <= factor <= MAX_FACTOR):
        raise InvalidInput(f"Scale factor must be between {MIN_FACTOR} and {MAX_FACTOR}", factor=factor)
    return factor


def scale_quantity(quantity: float | None, factor: float) -> float | None:
    if quantity is None:
        return None
    # Round away float noise (0.1 * 3 = 0.30000000000000004); the UI formats fractions.
    return round(quantity * factor, 3)


def scale_recipe(recipe: RecipeOut, factor: float) -> RecipeOut:
    if factor == 1.0:
        return recipe
    return recipe.model_copy(
        update={
            "yield_": recipe.yield_.model_copy(
                update={
                    "quantity": scale_quantity(recipe.yield_.quantity, factor),
                    "portions": scale_quantity(recipe.yield_.portions, factor),
                }
            ),
            "ingredients": [
                line.model_copy(update={"quantity": scale_quantity(line.quantity, factor)})
                for line in recipe.ingredients
            ],
            "scale_factor": round(factor, 4),
        }
    )

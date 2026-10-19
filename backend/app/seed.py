"""Seed data: two competing restaurants, a few recipes each.

Idempotent: an org that already has recipes is left alone.
Run manually with `python -m app.seed`.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Recipe
from app.repository import RecipeRepository
from app.schemas import RecipeIn


def _r(title, tags, yld, ingredients, steps) -> RecipeIn:
    return RecipeIn.model_validate(
        {
            "title": title,
            "tags": tags,
            "yield": yld,
            "ingredients": [
                dict(zip(("quantity", "unit", "name", "note"), line, strict=False)) for line in ingredients
            ],
            "steps": steps,
        }
    )


SEED: dict[str, list[RecipeIn]] = {
    "bistro": [
        _r(
            "House Vinaigrette",
            ["sauce", "cold station"],
            {"quantity": 1, "unit": "quart"},
            [
                (1, "cup", "red wine vinegar"),
                (2, "tbsp", "dijon mustard"),
                (1, "tbsp", "shallot", "minced"),
                (3, "cup", "olive oil"),
                (None, None, "salt and pepper", "to taste"),
            ],
            [
                "Whisk vinegar, mustard and shallot in a bowl.",
                "Stream in oil while whisking until emulsified.",
                "Season, label and date. Holds 7 days refrigerated.",
            ],
        ),
        _r(
            "Rosemary Focaccia",
            ["bread", "pastry", "vegetarian"],
            {"quantity": 2, "unit": "half sheet pan", "portions": 24},
            [
                (1000, "g", "bread flour"),
                (800, "g", "water", "lukewarm"),
                (20, "g", "fine salt"),
                (7, "g", "instant yeast"),
                (100, "ml", "olive oil", "plus more for pans"),
                (4, "sprig", "rosemary", "picked"),
            ],
            [
                "Mix flour, water, yeast; rest 20 minutes.",
                "Add salt; stretch and fold every 30 minutes, 4 times.",
                "Divide into oiled pans, proof 1 hour until doubled.",
                "Dimple, top with oil, rosemary and flaky salt.",
                "Bake at 450°F for 22–25 minutes until deep golden.",
            ],
        ),
        _r(
            "Braised Short Ribs",
            ["entree", "beef", "hot line"],
            {"quantity": 1, "unit": "hotel pan", "portions": 10},
            [
                (5, "kg", "bone-in short ribs"),
                (2, "each", "onion", "diced"),
                (2, "each", "carrot", "diced"),
                (750, "ml", "red wine"),
                (2, "l", "beef stock"),
                (3, "sprig", "thyme"),
            ],
            [
                "Season ribs and sear hard on all sides; remove.",
                "Sweat onion and carrot; deglaze with wine and reduce by half.",
                "Return ribs, cover with stock and thyme.",
                "Braise covered at 300°F for 3 hours until tender.",
                "Cool in liquid; skim fat and reduce sauce to order.",
            ],
        ),
        _r(
            "Lemon Tart",
            ["dessert", "pastry"],
            {"quantity": 1, "unit": "10-inch tart", "portions": 12},
            [
                (1, "each", "blind-baked tart shell"),
                (4, "each", "eggs"),
                (0.75, "cup", "sugar"),
                (0.5, "cup", "lemon juice", "fresh"),
                (1, "tbsp", "lemon zest"),
                (0.5, "cup", "heavy cream"),
            ],
            [
                "Whisk eggs, sugar, juice and zest; whisk in cream.",
                "Pour into shell; bake at 325°F for 20 minutes until just set.",
                "Chill at least 2 hours before slicing.",
            ],
        ),
    ],
    "harbor": [
        _r(
            "House Vinaigrette",
            ["sauce"],
            {"quantity": 2, "unit": "cup"},
            [
                (0.5, "cup", "champagne vinegar"),
                (1, "tbsp", "honey"),
                (1.5, "cup", "canola oil"),
                (None, None, "salt", "to taste"),
            ],
            ["Blend vinegar and honey.", "Stream in oil with blender running.", "Season and store cold."],
        ),
        _r(
            "New England Clam Chowder",
            ["soup", "seafood", "hot line"],
            {"quantity": 4, "unit": "quart", "portions": 16},
            [
                (3, "lb", "chopped clams", "reserve juice"),
                (8, "oz", "bacon", "diced"),
                (2, "each", "onion", "diced"),
                (2, "lb", "potatoes", "1/2-inch dice"),
                (2, "cup", "heavy cream"),
                (0.25, "cup", "flour"),
            ],
            [
                "Render bacon; sweat onion in the fat.",
                "Add flour, cook 2 minutes; whisk in clam juice.",
                "Simmer potatoes until just tender.",
                "Add clams and cream; heat through without boiling.",
            ],
        ),
        _r(
            "Baja Fish Tacos",
            ["entree", "seafood", "fry station"],
            {"quantity": 12, "unit": "taco", "portions": 4},
            [
                (1.5, "lb", "cod", "cut in strips"),
                (1, "cup", "flour"),
                (1, "cup", "lager", "cold"),
                (12, "each", "corn tortillas"),
                (2, "cup", "cabbage", "shredded"),
                (None, None, "lime crema", "for topping"),
            ],
            [
                "Whisk flour and lager to a thin batter.",
                "Dredge fish, dip in batter, fry at 360°F for 3–4 minutes.",
                "Build on warm tortillas with cabbage and crema.",
            ],
        ),
        _r(
            "Tartar Sauce",
            ["sauce", "cold station", "seafood"],
            {"quantity": 1, "unit": "pint"},
            [
                (1.5, "cup", "mayonnaise"),
                (0.25, "cup", "dill pickle", "finely diced"),
                (2, "tbsp", "capers", "chopped"),
                (1, "tbsp", "lemon juice"),
            ],
            ["Fold everything together.", "Rest 30 minutes before service. Holds 5 days."],
        ),
    ],
}


def seed(session: Session) -> int:
    created = 0
    for org_id, recipes in SEED.items():
        existing = session.scalar(select(func.count()).where(Recipe.org_id == org_id))
        if existing:
            continue
        repo = RecipeRepository(session, org_id)
        for data in recipes:
            repo.create(data)
            created += 1
    return created


if __name__ == "__main__":
    from sqlalchemy.orm import sessionmaker

    from app.config import Settings
    from app.db import init_db, make_engine

    engine = make_engine(Settings().database_url)
    init_db(engine)
    with sessionmaker(engine)() as s:
        print(f"Seeded {seed(s)} recipes")

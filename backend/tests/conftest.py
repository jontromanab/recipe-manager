import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import Base
from app.main import create_app

TOKENS = {
    "bistro_editor": "bistro-editor",
    "bistro_viewer": "bistro-viewer",
    "harbor_editor": "harbor-editor",
}


def auth(name: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKENS[name]}"}


def recipe_payload(**overrides) -> dict:
    body = {
        "title": "Test Stock",
        "tags": ["Base", "soup"],
        "yield": {"quantity": 4, "unit": "quart", "portions": 16},
        "ingredients": [
            {"quantity": 2, "unit": "kg", "name": "chicken bones"},
            {"quantity": 1, "unit": "each", "name": "onion", "note": "halved"},
            {"name": "salt", "note": "to taste"},
        ],
        "steps": ["Cover bones with cold water.", "Simmer 4 hours, skimming."],
    }
    body.update(overrides)
    return body


@pytest.fixture
def app():
    """Fresh, empty database per test, no seed data so counts are predictable.

    Defaults to in-memory SQLite. Set TEST_DATABASE_URL to run the same suite
    against another database, e.g. Postgres (tables are dropped after each test).
    """
    url = os.environ.get("TEST_DATABASE_URL", "sqlite://")
    app = create_app(Settings(database_url=url, seed_on_startup=False))
    yield app
    if url != "sqlite://":
        Base.metadata.drop_all(app.state.engine)
        app.state.engine.dispose()


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def session(client) -> Iterator[Session]:
    with client.app.state.session_factory() as s:
        yield s


@pytest.fixture
def create(client):
    def _create(user: str = "bistro_editor", **overrides) -> dict:
        r = client.post("/api/recipes", json=recipe_payload(**overrides), headers=auth(user))
        assert r.status_code == 201, r.text
        return r.json()

    return _create

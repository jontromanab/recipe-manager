import pytest

from app.errors import NotFound, VersionConflict
from app.repository import RecipeRepository
from app.schemas import RecipeIn, RecipeUpdate
from tests.conftest import recipe_payload


def data(**kw) -> RecipeIn:
    return RecipeIn.model_validate(recipe_payload(**kw))


def update(version: int, **kw) -> RecipeUpdate:
    return RecipeUpdate.model_validate(recipe_payload(version=version, **kw))


@pytest.fixture
def bistro(session):
    return RecipeRepository(session, "bistro")


@pytest.fixture
def harbor(session):
    return RecipeRepository(session, "harbor")


def test_requires_org():
    with pytest.raises(ValueError):
        RecipeRepository(None, "")  # type: ignore[arg-type]


def test_create_sets_version_and_search_text(bistro):
    r = bistro.create(data(title="Gravy", tags=["Sauce"]))
    assert r.version == 1
    assert r.org_id == "bistro"
    assert "gravy" in r.search_text and "sauce" in r.search_text and "onion" in r.search_text
    assert r.tags_index == "|sauce|"


class TestTenantIsolation:
    def test_get_other_org_is_not_found(self, bistro, harbor):
        r = bistro.create(data())
        with pytest.raises(NotFound):
            harbor.get(r.id)

    def test_list_only_returns_own_org(self, bistro, harbor):
        bistro.create(data(title="A"))
        harbor.create(data(title="B"))
        items, total = harbor.list()
        assert [i.title for i in items] == ["B"] and total == 1

    def test_update_delete_restore_other_org_not_found(self, bistro, harbor):
        r = bistro.create(data())
        with pytest.raises(NotFound):
            harbor.update(r.id, update(1))
        with pytest.raises(NotFound):
            harbor.delete(r.id)
        bistro.delete(r.id)
        with pytest.raises(NotFound):
            harbor.restore(r.id)


class TestSoftDelete:
    def test_deleted_hidden_from_get_and_list(self, bistro):
        r = bistro.create(data())
        bistro.delete(r.id)
        with pytest.raises(NotFound):
            bistro.get(r.id)
        assert bistro.list() == ([], 0)
        assert bistro.get(r.id, include_deleted=True).deleted_at is not None

    def test_restore_brings_back(self, bistro):
        r = bistro.create(data())
        bistro.delete(r.id)
        bistro.restore(r.id)
        assert bistro.get(r.id).deleted_at is None

    def test_restore_not_deleted_is_not_found(self, bistro):
        r = bistro.create(data())
        with pytest.raises(NotFound):
            bistro.restore(r.id)

    def test_cannot_update_deleted(self, bistro):
        r = bistro.create(data())
        bistro.delete(r.id)
        with pytest.raises(NotFound):
            bistro.update(r.id, update(r.version))


class TestVersioning:
    def test_update_bumps_version(self, bistro):
        r = bistro.create(data())
        r2 = bistro.update(r.id, update(1, title="New"))
        assert r2.version == 2 and r2.title == "New"

    def test_stale_version_conflicts(self, bistro):
        r = bistro.create(data())
        bistro.update(r.id, update(1, title="First"))
        with pytest.raises(VersionConflict) as exc:
            bistro.update(r.id, update(1, title="Second"))
        assert exc.value.extra["current_version"] == 2
        assert bistro.get(r.id).title == "First"

    def test_race_after_check_is_caught(self, client, bistro):
        """Another writer commits between our read and our commit."""
        r = bistro.create(data())
        with client.app.state.session_factory() as other_session:
            other = RecipeRepository(other_session, "bistro")
            mine = bistro.get(r.id)  # loaded at version 1
            other.update(r.id, update(1, title="Theirs"))
            mine.title = "Mine"
            with pytest.raises(VersionConflict):
                bistro._commit_or_conflict(mine)


class TestSearch:
    @pytest.fixture(autouse=True)
    def recipes(self, bistro):
        bistro.create(data(title="Tomato Soup", tags=["soup", "vegan"],
                           ingredients=[{"quantity": 1, "unit": "kg", "name": "tomatoes"}]))
        bistro.create(data(title="Caesar Salad", tags=["salad"],
                           ingredients=[{"quantity": 2, "unit": "each", "name": "anchovy"}]))
        bistro.create(data(title="100% Rye", tags=["bread"],
                           ingredients=[{"quantity": 1, "unit": "kg", "name": "rye_flour"}]))

    @pytest.mark.parametrize(
        "q, expected",
        [
            ("soup", ["Tomato Soup"]),           # title
            ("ANCHOVY", ["Caesar Salad"]),       # ingredient, case-insensitive
            ("vegan", ["Tomato Soup"]),          # tag
            ("tomato soup", ["Tomato Soup"]),    # every term must match
            ("tomato anchovy", []),
            ("", ["100% Rye", "Caesar Salad", "Tomato Soup"]),
            ("   ", ["100% Rye", "Caesar Salad", "Tomato Soup"]),  # whitespace-only = no filter
            ("  soup  ", ["Tomato Soup"]),                         # surrounding spaces ignored
            ("%", ["100% Rye"]),                 # LIKE wildcards are literal
            ("_", ["100% Rye"]),
            ("nothing", []),
        ],
    )
    def test_query(self, bistro, q, expected):
        items, total = bistro.list(q=q)
        assert [i.title for i in items] == expected
        assert total == len(expected)

    def test_tag_filter_matches_whole_tag(self, bistro):
        assert [i.title for i in bistro.list(tag="soup")[0]] == ["Tomato Soup"]
        assert bistro.list(tag="sou")[1] == 0
        assert bistro.list(tag="SALAD")[1] == 1
        assert bistro.list(tag="   ")[1] == 3  # whitespace-only tag = no filter


class TestPagination:
    @pytest.fixture(autouse=True)
    def recipes(self, bistro):
        for i in range(5):
            bistro.create(data(title=f"Recipe {i}"))

    def test_page_and_total(self, bistro):
        items, total = bistro.list(limit=2, offset=2)
        assert [i.title for i in items] == ["Recipe 2", "Recipe 3"]
        assert total == 5

    def test_offset_past_end(self, bistro):
        assert bistro.list(limit=2, offset=50) == ([], 5)

    def test_limit_clamped(self, bistro):
        items, _ = bistro.list(limit=10_000)
        assert len(items) == 5

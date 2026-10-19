import pytest

from tests.conftest import auth, recipe_payload


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


class TestAuth:
    def test_missing_token_401(self, client):
        r = client.get("/api/recipes")
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "unauthorized"
        assert r.headers["www-authenticate"] == "Bearer"

    def test_bad_token_401(self, client):
        r = client.get("/api/recipes", headers={"Authorization": "Bearer nope"})
        assert r.status_code == 401

    def test_me(self, client):
        r = client.get("/api/me", headers=auth("bistro_viewer"))
        assert r.json()["org_id"] == "bistro" and r.json()["role"] == "viewer"

    def test_viewer_can_read(self, client, create):
        rid = create()["id"]
        assert client.get(f"/api/recipes/{rid}", headers=auth("bistro_viewer")).status_code == 200
        assert client.get("/api/recipes", headers=auth("bistro_viewer")).status_code == 200

    @pytest.mark.parametrize(
        "method, path, body",
        [
            ("post", "/api/recipes", recipe_payload()),
            ("put", "/api/recipes/{id}", recipe_payload(version=1)),
            ("delete", "/api/recipes/{id}", None),
            ("post", "/api/recipes/{id}/restore", None),
        ],
    )
    def test_viewer_cannot_write(self, client, create, method, path, body):
        rid = create()["id"]
        r = client.request(method, path.format(id=rid), json=body, headers=auth("bistro_viewer"))
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "forbidden"


class TestCrud:
    def test_round_trip(self, client, create):
        created = create()
        assert created["version"] == 1
        assert created["tags"] == ["base", "soup"]
        assert created["yield"] == {"quantity": 4, "unit": "quart", "portions": 16}
        assert created["ingredients"][2] == {"quantity": None, "unit": None, "name": "salt", "note": "to taste"}

        rid = created["id"]
        got = client.get(f"/api/recipes/{rid}", headers=auth("bistro_editor")).json()
        assert got["title"] == "Test Stock" and got["scale_factor"] == 1.0

        r = client.put(f"/api/recipes/{rid}", json=recipe_payload(title="Brown Stock", version=1),
                       headers=auth("bistro_editor"))
        assert r.status_code == 200
        assert r.json()["version"] == 2 and r.json()["title"] == "Brown Stock"

        assert client.delete(f"/api/recipes/{rid}", headers=auth("bistro_editor")).status_code == 204
        assert client.get(f"/api/recipes/{rid}", headers=auth("bistro_editor")).status_code == 404

        r = client.post(f"/api/recipes/{rid}/restore", headers=auth("bistro_editor"))
        assert r.status_code == 200 and r.json()["title"] == "Brown Stock"

    def test_invalid_body_422_with_details(self, client):
        r = client.post("/api/recipes", json=recipe_payload(title="", ingredients=[]),
                        headers=auth("bistro_editor"))
        assert r.status_code == 422
        err = r.json()["error"]
        assert err["code"] == "invalid_input"
        assert {tuple(d["loc"][-1:]) for d in err["details"]} >= {("title",), ("ingredients",)}

    def test_unknown_id_404(self, client):
        r = client.get("/api/recipes/999", headers=auth("bistro_editor"))
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"

    def test_non_integer_id_422(self, client):
        assert client.get("/api/recipes/abc", headers=auth("bistro_editor")).status_code == 422

    def test_stale_update_409(self, client, create):
        rid = create()["id"]
        h = auth("bistro_editor")
        client.put(f"/api/recipes/{rid}", json=recipe_payload(title="One", version=1), headers=h)
        r = client.put(f"/api/recipes/{rid}", json=recipe_payload(title="Two", version=1), headers=h)
        assert r.status_code == 409
        assert r.json()["error"] == {
            "code": "version_conflict",
            "message": "Recipe was changed by someone else; reload and reapply your edits",
            "current_version": 2,
        }
        assert client.get(f"/api/recipes/{rid}", headers=h).json()["title"] == "One"

    def test_update_without_version_422(self, client, create):
        rid = create()["id"]
        r = client.put(f"/api/recipes/{rid}", json=recipe_payload(), headers=auth("bistro_editor"))
        assert r.status_code == 422

    def test_delete_twice_404(self, client, create):
        rid = create()["id"]
        h = auth("bistro_editor")
        client.delete(f"/api/recipes/{rid}", headers=h)
        assert client.delete(f"/api/recipes/{rid}", headers=h).status_code == 404


class TestCrossTenant:
    @pytest.mark.parametrize(
        "method, path, body",
        [
            ("get", "/api/recipes/{id}", None),
            ("put", "/api/recipes/{id}", recipe_payload(version=1)),
            ("delete", "/api/recipes/{id}", None),
            ("post", "/api/recipes/{id}/restore", None),
        ],
    )
    def test_other_org_gets_404(self, client, create, method, path, body):
        rid = create("bistro_editor")["id"]
        r = client.request(method, path.format(id=rid), json=body, headers=auth("harbor_editor"))
        assert r.status_code == 404
        # And nothing changed for the owner.
        assert client.get(f"/api/recipes/{rid}", headers=auth("bistro_editor")).json()["version"] == 1

    def test_search_does_not_leak(self, client, create):
        create("bistro_editor", title="Secret Sauce")
        r = client.get("/api/recipes", params={"q": "secret"}, headers=auth("harbor_editor"))
        assert r.json()["total"] == 0


class TestListAndSearch:
    def test_list_shape_and_pagination(self, client, create):
        for i in range(3):
            create(title=f"R{i}")
        r = client.get("/api/recipes", params={"limit": 2, "offset": 1}, headers=auth("bistro_viewer"))
        body = r.json()
        assert body["total"] == 3 and body["limit"] == 2 and body["offset"] == 1
        assert [i["title"] for i in body["items"]] == ["R1", "R2"]
        assert "ingredients" not in body["items"][0]  # summaries stay small

    @pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}, {"q": "x" * 101}])
    def test_bad_list_params_422(self, client, params):
        assert client.get("/api/recipes", params=params, headers=auth("bistro_viewer")).status_code == 422

    def test_whitespace_only_search_returns_all(self, client, create):
        create(title="A")
        create(title="B")
        r = client.get("/api/recipes", params={"q": "   ", "tag": "  "}, headers=auth("bistro_viewer"))
        assert r.status_code == 200 and r.json()["total"] == 2

    def test_search_by_ingredient_and_tag(self, client, create):
        create(title="Pesto", tags=["sauce"], ingredients=[{"quantity": 2, "unit": "cup", "name": "basil"}])
        create(title="Stock")
        h = auth("bistro_viewer")
        assert [i["title"] for i in client.get("/api/recipes", params={"q": "basil"}, headers=h).json()["items"]] == ["Pesto"]
        assert client.get("/api/recipes", params={"tag": "sauce"}, headers=h).json()["total"] == 1


class TestScalingEndpoint:
    def test_scale(self, client, create):
        rid = create()["id"]
        r = client.get(f"/api/recipes/{rid}", params={"scale": 1.5}, headers=auth("bistro_viewer")).json()
        assert r["scale_factor"] == 1.5
        assert r["yield"]["quantity"] == 6 and r["yield"]["portions"] == 24
        assert [i["quantity"] for i in r["ingredients"]] == [3, 1.5, None]

    def test_target_yield(self, client, create):
        rid = create()["id"]
        r = client.get(f"/api/recipes/{rid}", params={"target_yield": 1}, headers=auth("bistro_viewer")).json()
        assert r["scale_factor"] == 0.25 and r["ingredients"][0]["quantity"] == 0.5

    def test_scaling_does_not_persist(self, client, create):
        rid = create()["id"]
        h = auth("bistro_viewer")
        client.get(f"/api/recipes/{rid}", params={"scale": 3}, headers=h)
        assert client.get(f"/api/recipes/{rid}", headers=h).json()["ingredients"][0]["quantity"] == 2

    @pytest.mark.parametrize(
        "params",
        [{"scale": 0}, {"scale": -1}, {"scale": 500}, {"scale": 2, "target_yield": 8}, {"target_yield": 0}],
    )
    def test_bad_scale_422(self, client, create, params):
        rid = create()["id"]
        r = client.get(f"/api/recipes/{rid}", params=params, headers=auth("bistro_viewer"))
        assert r.status_code == 422


def test_seed_is_idempotent(session):
    from app.seed import seed

    first = seed(session)
    assert first > 0
    assert seed(session) == 0

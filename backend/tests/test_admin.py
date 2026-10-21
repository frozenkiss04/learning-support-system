"""Admin blueprint: /api/admin/* must reject learners and anonymous calls."""


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def test_stats_requires_auth(client):
    assert client.get("/api/admin/stats").status_code == 401


def test_stats_forbidden_for_learner(client, learner_headers):
    resp = client.get("/api/admin/stats", headers=learner_headers)
    assert resp.status_code == 403
    assert resp.get_json()["success"] is False


def test_stats_for_admin_returns_counts(client, admin_headers, learner, sample_course):
    resp = client.get("/api/admin/stats", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["total_learners"] == 1        # only the learner fixture
    assert data["total_courses"] == 2         # published + draft from fixture
    assert data["total_lessons"] == 1
    assert data["total_attempts"] == 0
    assert data["accuracy_percent"] == 0


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

def test_users_list_forbidden_for_learner(client, learner_headers):
    resp = client.get("/api/admin/users", headers=learner_headers)
    assert resp.status_code == 403


def test_users_list_requires_auth(client):
    assert client.get("/api/admin/users").status_code == 401


def test_users_list_for_admin_with_pagination_meta(client, admin_headers, learner, admin):
    resp = client.get("/api/admin/users", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["total"] == 2
    assert body["page"] == 1
    emails = [u["email"] for u in body["data"]]
    assert learner.email in emails
    assert admin.email in emails


def test_users_list_search_filters_results(client, admin_headers, learner):
    resp = client.get("/api/admin/users", query_string={"q": "learner@"},
                      headers=admin_headers)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["total"] == 1
    assert body["data"][0]["email"] == learner.email


# ---------------------------------------------------------------------------
# Content management (ADMIN only, teachers are not enough)
# ---------------------------------------------------------------------------

def test_create_course_forbidden_for_learner(client, learner_headers):
    resp = client.post("/api/admin/courses",
                       json={"title": "Hack", "slug": "hack"},
                       headers=learner_headers)
    assert resp.status_code == 403


def test_create_course_requires_auth(client):
    resp = client.post("/api/admin/courses", json={"title": "X", "slug": "x"})
    assert resp.status_code == 401


def test_create_course_and_unit_as_admin(client, admin_headers):
    resp = client.post("/api/admin/courses",
                       json={"title": "Tiếng Anh B1", "slug": "english-b1",
                             "level": "B1", "is_published": True},
                       headers=admin_headers)
    assert resp.status_code == 201
    course = resp.get_json()["data"]
    assert course["slug"] == "english-b1"
    assert course["is_published"] is True

    unit = client.post(f"/api/admin/courses/{course['id']}/units",
                       json={"title": "Unit 1", "order_index": 1},
                       headers=admin_headers)
    assert unit.status_code == 201
    assert unit.get_json()["data"]["title"] == "Unit 1"

    # The new published course is immediately visible to learners.
    listing = client.get("/api/courses")
    assert "english-b1" in [c["slug"] for c in listing.get_json()["data"]]

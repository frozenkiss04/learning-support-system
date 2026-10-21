"""Health endpoint — mounted at /health (no /api prefix)."""


def test_health_returns_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["data"]["service"] == "learning-support-api"


def test_health_reports_database_up(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json()["data"]["database"] == "up"


def test_health_needs_no_auth(client):
    # No Authorization header at all — monitoring probes must get through.
    resp = client.get("/health")
    assert resp.status_code != 401


def test_unknown_route_is_404(client):
    resp = client.get("/api/this-route-does-not-exist")
    assert resp.status_code == 404

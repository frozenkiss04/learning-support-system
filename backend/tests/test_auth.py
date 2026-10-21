"""Auth blueprint: /api/auth/register, /login, /refresh, /me."""
import pytest

REGISTER_URL = "/api/auth/register"
LOGIN_URL = "/api/auth/login"

NEW_USER = {
    "email": "new.user@example.com",
    "password": "Password@123",
    "full_name": "Người Dùng Mới",
}


def _register(client, **overrides):
    return client.post(REGISTER_URL, json={**NEW_USER, **overrides})


# ---------------------------------------------------------------------------
# Register
# ---------------------------------------------------------------------------

def test_register_success_returns_201_and_learner_role(client):
    resp = _register(client)
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["success"] is True
    assert body["data"]["email"] == NEW_USER["email"]
    assert body["data"]["full_name"] == NEW_USER["full_name"]
    assert body["data"]["role"] == "LEARNER"


def test_register_never_grants_admin_role_from_body(client):
    """Security regression test: role in the request body must be ignored."""
    resp = _register(client, role="ADMIN")
    assert resp.status_code == 201
    assert resp.get_json()["data"]["role"] == "LEARNER"

    # …and the stored role really is LEARNER, proven through login + /me.
    login = client.post(LOGIN_URL, json={
        "email": NEW_USER["email"], "password": NEW_USER["password"],
    })
    token = login.get_json()["data"]["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.get_json()["data"]["role"] == "LEARNER"


def test_register_duplicate_email_returns_409(client):
    assert _register(client).status_code == 201
    resp = _register(client)
    assert resp.status_code == 409
    assert resp.get_json()["success"] is False


def test_register_short_password_returns_400(client):
    resp = _register(client, password="short")
    assert resp.status_code == 400


@pytest.mark.parametrize("payload", [
    {"password": "Password@123", "full_name": "Thiếu Email"},          # no email
    {"email": "not-an-email", "password": "Password@123", "full_name": "Email Sai"},
    {"email": "a@b.com", "full_name": "Thiếu Mật Khẩu"},               # no password
    {"email": "a@b.com", "password": "Password@123"},                  # no full_name
    {},
])
def test_register_missing_or_invalid_fields_returns_400(client, payload):
    resp = client.post(REGISTER_URL, json=payload)
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


def test_register_then_login_roundtrip(client):
    assert _register(client).status_code == 201
    resp = client.post(LOGIN_URL, json={
        "email": NEW_USER["email"], "password": NEW_USER["password"],
    })
    assert resp.status_code == 200
    assert resp.get_json()["data"]["user"]["email"] == NEW_USER["email"]


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

def test_login_success_returns_tokens_and_user(client, learner):
    from conftest import LEARNER_EMAIL, LEARNER_PASSWORD

    resp = client.post(LOGIN_URL, json={
        "email": LEARNER_EMAIL, "password": LEARNER_PASSWORD,
    })
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["access_token"]
    assert data["refresh_token"]
    assert data["user"]["email"] == LEARNER_EMAIL
    assert data["user"]["role"] == "LEARNER"


def test_login_wrong_password_returns_401(client, learner):
    from conftest import LEARNER_EMAIL

    resp = client.post(LOGIN_URL, json={
        "email": LEARNER_EMAIL, "password": "SaiMatKhau@999",
    })
    assert resp.status_code == 401
    assert resp.get_json()["success"] is False


def test_login_unknown_email_returns_401(client):
    resp = client.post(LOGIN_URL, json={
        "email": "ghost@example.com", "password": "Password@123",
    })
    assert resp.status_code == 401


def test_login_email_is_case_insensitive(client, learner):
    from conftest import LEARNER_PASSWORD

    resp = client.post(LOGIN_URL, json={
        "email": "LEARNER@EXAMPLE.COM", "password": LEARNER_PASSWORD,
    })
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# /me and /refresh
# ---------------------------------------------------------------------------

def test_me_returns_profile_and_streak(client, learner_headers, learner):
    from conftest import LEARNER_EMAIL

    resp = client.get("/api/auth/me", headers=learner_headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["email"] == LEARNER_EMAIL
    assert data["role"] == "LEARNER"
    assert data["xp"] == 0
    assert data["current_streak"] == 0


def test_me_without_token_returns_401(client):
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_me_with_garbage_token_returns_401(client):
    resp = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-token"})
    assert resp.status_code == 401


def test_refresh_token_issues_new_access_token(client, learner):
    from conftest import LEARNER_EMAIL, LEARNER_PASSWORD

    login = client.post(LOGIN_URL, json={
        "email": LEARNER_EMAIL, "password": LEARNER_PASSWORD,
    })
    refresh_token = login.get_json()["data"]["refresh_token"]

    resp = client.post("/api/auth/refresh",
                       headers={"Authorization": f"Bearer {refresh_token}"})
    assert resp.status_code == 200
    new_access = resp.get_json()["data"]["access_token"]
    assert new_access

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {new_access}"})
    assert me.status_code == 200


def test_refresh_rejects_access_token(client, learner_token):
    resp = client.post("/api/auth/refresh",
                       headers={"Authorization": f"Bearer {learner_token}"})
    assert resp.status_code == 401

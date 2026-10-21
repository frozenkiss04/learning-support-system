"""AI chat blueprint in stub mode (no provider API key configured).

conftest strips GEMINI_API_KEY / OPENAI_API_KEY before the app is imported,
so AiService replies with its plainly-labelled stub text and no network
call is ever made.
"""


def _chat(client, headers, **payload):
    body = {"message": "Giải thích thì hiện tại đơn giúp em", "context_type": "LESSON"}
    body.update(payload)
    return client.post("/api/ai/chat", json=body, headers=headers)


def test_chat_stub_mode_returns_200_and_reply(client, learner_headers, sample_course):
    resp = _chat(client, learner_headers, context_id=sample_course["lesson_id"])
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["session_id"]
    assert data["reply"]
    assert "stub" in data["reply"].lower()  # stub mode must identify itself


def test_chat_creates_session_listed_for_owner(client, learner_headers, sample_course):
    created = _chat(client, learner_headers, context_id=sample_course["lesson_id"])
    session_id = created.get_json()["data"]["session_id"]

    sessions = client.get("/api/ai/sessions", headers=learner_headers)
    assert sessions.status_code == 200
    assert session_id in [s["id"] for s in sessions.get_json()["data"]]


def test_chat_continues_existing_session(client, learner_headers, sample_course):
    first = _chat(client, learner_headers, context_id=sample_course["lesson_id"])
    session_id = first.get_json()["data"]["session_id"]

    second = _chat(client, learner_headers, session_id=session_id,
                   message="Cho em ví dụ khác")
    assert second.status_code == 200
    assert second.get_json()["data"]["session_id"] == session_id


def test_chat_empty_message_returns_400(client, learner_headers):
    resp = client.post("/api/ai/chat", json={"message": "   "}, headers=learner_headers)
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


def test_chat_requires_auth(client):
    resp = client.post("/api/ai/chat", json={"message": "Xin chào"})
    assert resp.status_code == 401


def test_chat_sessions_are_private_to_owner(client, learner_headers, admin_headers, sample_course):
    created = _chat(client, learner_headers, context_id=sample_course["lesson_id"])
    session_id = created.get_json()["data"]["session_id"]

    # Another user (even an admin account) cannot continue someone else's
    # learner session through the chat endpoint.
    hijack = _chat(client, admin_headers, session_id=session_id, message="Đọc trộm")
    assert hijack.status_code == 404


def test_admin_assistant_context_forbidden_for_learner(client, learner_headers):
    resp = _chat(client, learner_headers, context_type="ADMIN", context_id=None,
                 message="Tuần này có bao nhiêu học viên?")
    assert resp.status_code == 403


def test_admin_assistant_context_works_for_admin(client, admin_headers):
    resp = _chat(client, admin_headers, context_type="ADMIN", context_id=None,
                 message="Tuần này có bao nhiêu học viên?")
    assert resp.status_code == 200
    assert resp.get_json()["data"]["reply"]


def test_chat_stream_sse_stub_mode(client, learner_headers, sample_course):
    resp = client.post("/api/ai/chat/stream",
                       json={"message": "Xin chào", "context_type": "LESSON",
                             "context_id": sample_course["lesson_id"]},
                       headers=learner_headers)
    assert resp.status_code == 200
    assert resp.mimetype == "text/event-stream"
    body = resp.get_data(as_text=True)
    assert "data:" in body
    assert "[DONE]" in body

"""AI chat blueprint in stub mode (no provider API key configured).

conftest strips GEMINI_API_KEY / OPENAI_API_KEY before the app is imported,
so AiService replies with its plainly-labelled stub text and no network
call is ever made.
"""
from app.blueprints.ai_chat import MAX_HISTORY_CHARS, _history
from app.extensions import db
from app.models.chat import ChatMessage, ChatSession


def _make_session_with_messages(learner, contents):
    session = ChatSession(user_id=learner.id, context_type="LESSON",
                          context_id=None, title="t")
    db.session.add(session)
    db.session.flush()
    for i, content in enumerate(contents):
        db.session.add(ChatMessage(
            session_id=session.id,
            role="user" if i % 2 == 0 else "assistant",
            content=content))
    db.session.commit()
    return session


def test_history_trims_to_char_budget(app, learner):
    session = _make_session_with_messages(learner, ["x" * 1000] * 30)
    history = _history(session)
    assert len(history) == MAX_HISTORY_CHARS // 1000  # 6 lượt gần nhất
    assert sum(len(m["content"]) for m in history) <= MAX_HISTORY_CHARS


def test_history_keeps_short_session_whole(app, learner):
    session = _make_session_with_messages(learner, ["hello"] * 4)
    assert len(_history(session)) == 4


def test_history_always_keeps_last_message(app, learner):
    session = _make_session_with_messages(
        learner, ["x" * 100] * 5 + ["y" * 8000])
    history = _history(session)
    assert len(history) == 1
    assert history[0]["content"] == "y" * 8000


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

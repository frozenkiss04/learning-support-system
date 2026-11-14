"""Tutor agent: routing (small talk skips retrieval), RAG grounding, trace.

Runs fully offline — stub AI mode (conftest strips provider keys) and the
local embedder. Retrieval assertions use the sample course fixture.
"""
from types import SimpleNamespace

import pytest

from app.services import rag_service
from app.services.tutor_agent import TutorAgent, is_small_talk


@pytest.mark.parametrize("message,expected", [
    ("Xin chào", True),
    ("xin chào bạn nhé", True),
    ("Cảm ơn bạn", True),
    ("cảm ơn", True),
    ("hello", True),
    ("Hi!", True),
    ("tạm biệt", True),
    ("bạn là ai?", True),
    ("ok", True),
    ("", True),
    # "hi" prefix must not match "history".
    ("history là gì?", False),
    ("tại sao?", False),
    ("Good morning nghĩa là gì?", False),
    # Greeting + real content still retrieves.
    ("xin chào, giải thích giúp em thì hiện tại đơn", False),
    ("hôm nay học gì?", False),
])
def test_is_small_talk(message, expected):
    assert is_small_talk(message) is expected


def test_agent_skips_retrieval_for_small_talk(sample_course, monkeypatch):
    rag_service.build_index()
    calls = []
    orig = rag_service.retrieve

    def counting(*args, **kwargs):
        calls.append(1)
        return orig(*args, **kwargs)

    monkeypatch.setattr(rag_service, "retrieve", counting)
    session = SimpleNamespace(context_type="LESSON",
                              context_id=sample_course["lesson_id"])
    ctx = TutorAgent().prepare(
        session, [{"role": "user", "content": "Xin chào"}], "BASE")
    assert calls == []
    assert ctx.system == "BASE"
    assert ctx.sources == []
    assert ctx.trace[0]["detail"] == "skip"


def test_agent_retrieves_and_grounds_course_question(sample_course):
    rag_service.build_index()
    session = SimpleNamespace(context_type="LESSON",
                              context_id=sample_course["lesson_id"])
    ctx = TutorAgent().prepare(
        session, [{"role": "user", "content": "Good morning nghĩa là gì?"}],
        "BASE")
    assert ctx.sources, "expected RAG sources for a course question"
    assert "TÀI LIỆU KHÓA HỌC LIÊN QUAN" in ctx.system
    assert [s["step"] for s in ctx.trace] == ["route", "retrieve"]
    assert "hits via python" in ctx.trace[1]["detail"]


def test_agent_prepare_skips_non_lesson(app):
    session = SimpleNamespace(context_type="ROLEPLAY", context_id=None)
    ctx = TutorAgent().prepare(
        session, [{"role": "user", "content": "Hello!"}], "BASE")
    assert ctx.system == "BASE"
    assert ctx.sources == []
    assert ctx.trace[0]["detail"] == "skip (not LESSON)"


def test_chat_response_includes_trace(client, learner_headers, sample_course):
    rag_service.build_index()
    resp = client.post(
        "/api/ai/chat",
        json={"message": "Good morning nghĩa là gì?",
              "context_type": "LESSON",
              "context_id": sample_course["lesson_id"]},
        headers=learner_headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["stub"] is True
    assert [s["step"] for s in data["trace"]] == ["route", "retrieve", "answer"]


def test_small_talk_chat_trace_has_no_retrieve(
        client, learner_headers, sample_course):
    rag_service.build_index()
    resp = client.post(
        "/api/ai/chat",
        json={"message": "Xin chào",
              "context_type": "LESSON",
              "context_id": sample_course["lesson_id"]},
        headers=learner_headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert [s["step"] for s in data["trace"]] == ["route", "answer"]


def test_rag_block_truncates_long_chunks(sample_course):
    from app.extensions import db
    from app.models.rag import KnowledgeChunk
    from app.services.tutor_agent import MAX_CHUNK_CHARS

    rag_service.build_index()
    db.session.query(KnowledgeChunk).update({"content": "x" * 2000})
    db.session.commit()
    rag_service.clear_caches()
    session = SimpleNamespace(context_type="LESSON",
                              context_id=sample_course["lesson_id"])
    ctx = TutorAgent().prepare(
        session, [{"role": "user", "content": "Good morning nghĩa là gì?"}],
        "BASE")
    assert ctx.hits
    assert "x" * (MAX_CHUNK_CHARS + 1) not in ctx.system


def test_answer_falls_back_to_rag_when_provider_fails(
        sample_course, monkeypatch):
    from app.services.ai_service import AiProviderError

    rag_service.build_index()
    session = SimpleNamespace(context_type="LESSON",
                              context_id=sample_course["lesson_id"])
    agent = TutorAgent()

    def boom(*args, **kwargs):
        raise AiProviderError("lỗi giả")

    monkeypatch.setattr(agent.service, "chat", boom)
    reply, sources, trace, source = agent.answer(
        session, [{"role": "user", "content": "Good morning nghĩa là gì?"}],
        "BASE")
    assert source == "rag_fallback"
    assert "đang bận" in reply
    assert sources and sources[0] in reply
    assert trace[-1]["step"] == "fallback"


def test_answer_reraises_without_rag_hits(sample_course, monkeypatch):
    from app.services.ai_service import AiProviderError

    # Không build index -> retrieve rỗng -> không có fallback.
    session = SimpleNamespace(context_type="LESSON",
                              context_id=sample_course["lesson_id"])
    agent = TutorAgent()

    def boom(*args, **kwargs):
        raise AiProviderError("lỗi giả")

    monkeypatch.setattr(agent.service, "chat", boom)
    with pytest.raises(AiProviderError):
        agent.answer(
            session, [{"role": "user", "content": "Good morning nghĩa là gì?"}],
            "BASE")

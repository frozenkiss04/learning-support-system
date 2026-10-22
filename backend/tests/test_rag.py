"""RAG: indexing, retrieval, admin endpoints, tutor wiring.

Runs fully offline — conftest strips GEMINI_API_KEY, so the embedder is the
deterministic local hashing vectorizer and ``embedding_mode()`` is "local".
Sample content (conftest): 1 published lesson "Hello and introductions"
with 3 exercises + 1 unpublished draft course that must never be indexed.
"""
from app.services import rag_service


def test_build_index_creates_chunks_from_published_content(sample_course):
    result = rag_service.build_index()
    assert result["mode"] == "local"
    # 1 lesson chunk + 3 exercise chunks; the draft course contributes none.
    assert result["chunks"] == 4


def test_build_index_is_idempotent(sample_course):
    first = rag_service.build_index()["chunks"]
    second = rag_service.build_index()["chunks"]
    assert first == second == 4


def test_retrieve_returns_best_matching_chunk_first(sample_course):
    rag_service.build_index()
    hits = rag_service.retrieve("Good morning là câu chào vào buổi sáng")
    assert hits, "expected at least one chunk above the local threshold"
    top = hits[0]
    assert top["source_type"] == "exercise"
    assert top["source_id"] == sample_course["exercise_ids"][0]
    assert top["score"] > 0.05
    assert "Good morning" in top["content"]


def test_retrieve_course_filter(sample_course):
    rag_service.build_index()
    hits = rag_service.retrieve(
        "Good morning", course_id=sample_course["course_id"])
    assert hits
    # The draft course has no indexed chunks at all.
    assert rag_service.retrieve(
        "Good morning", course_id=sample_course["draft_course_id"]) == []


def test_admin_rag_stats_permissions_and_shape(client, learner_headers,
                                              admin_headers, sample_course):
    rag_service.build_index()
    forbidden = client.get("/api/admin/rag/stats", headers=learner_headers)
    assert forbidden.status_code == 403

    resp = client.get("/api/admin/rag/stats", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["chunks"] == 4
    assert data["mode"] == "local"
    assert data["lessons_indexed"] == 1
    assert data["exercises_indexed"] == 3


def test_admin_rag_reindex(client, learner_headers, admin_headers, sample_course):
    forbidden = client.post("/api/admin/rag/reindex", headers=learner_headers)
    assert forbidden.status_code == 403

    resp = client.post("/api/admin/rag/reindex", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["chunks"] == 4
    assert data["mode"] == "local"


def test_tutor_chat_stub_still_200_and_cites_rag_sources(
        client, learner_headers, sample_course):
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
    # Stub mode appends the matched RAG sources to the reply.
    assert "Nguồn tham khảo liên quan" in data["reply"]

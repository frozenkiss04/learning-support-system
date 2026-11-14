"""RAG: indexing, retrieval, admin endpoints, tutor wiring.

Runs fully offline — conftest strips GEMINI_API_KEY, so the embedder is the
deterministic local hashing vectorizer and ``embedding_mode()`` is "local".
Sample content (conftest): 1 published lesson "Hello and introductions"
with 3 exercises + 1 unpublished draft course that must never be indexed.
"""
import requests

from app.extensions import db
from app.models.rag import KnowledgeChunk
from app.services import rag_service


class _FakeEmbedResp:
    def __init__(self, status_code=200):
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} Server Error")


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
    assert data["search_backend"] == "python"
    assert data["vector_chunks"] == 0
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


# ---------------------------------------------------------------------------
# Caching, batch embedding, pgvector readiness
# ---------------------------------------------------------------------------

def test_embed_caches_repeated_queries(monkeypatch):
    calls = []
    orig = rag_service._embed_local

    def counting(text):
        calls.append(text)
        return orig(text)

    monkeypatch.setattr(rag_service, "_embed_local", counting)
    assert rag_service.embed("Hello world") == rag_service.embed("Hello world")
    assert len(calls) == 1


def test_retrieve_caches_results_and_build_index_clears_it(
        sample_course, monkeypatch):
    calls = []
    orig = rag_service._retrieve_python

    def counting(*args, **kwargs):
        calls.append(1)
        return orig(*args, **kwargs)

    monkeypatch.setattr(rag_service, "_retrieve_python", counting)
    rag_service.build_index()
    first = rag_service.retrieve("Good morning")
    second = rag_service.retrieve("Good morning")
    assert first == second
    assert len(calls) == 1, "second identical query must hit the cache"
    rag_service.build_index()
    rag_service.retrieve("Good morning")
    assert len(calls) == 2, "reindex must invalidate the retrieve cache"


def test_embed_batch_single_call_in_gemini_mode(monkeypatch):
    monkeypatch.setattr(rag_service, "embedding_mode", lambda: "gemini")
    calls = []

    def fake_batch(texts):
        calls.append(list(texts))
        return [[1.0, 0.0] for _ in texts]

    monkeypatch.setattr(rag_service, "_embed_batch_gemini", fake_batch)
    out = rag_service.embed_batch(["a", "b", "c"])
    assert len(calls) == 1 and calls[0] == ["a", "b", "c"]
    assert out == [[1.0, 0.0]] * 3


def test_embed_batch_falls_back_to_per_text_on_failure(monkeypatch):
    monkeypatch.setattr(rag_service, "embedding_mode", lambda: "gemini")
    monkeypatch.setattr(rag_service, "_embed_batch_gemini",
                        lambda texts: (_ for _ in ()).throw(RuntimeError("boom")))
    monkeypatch.setattr(rag_service, "_embed_gemini",
                        lambda text: (_ for _ in ()).throw(RuntimeError("boom")))
    out = rag_service.embed_batch(["a", "b"])
    # Batch failed, per-text Gemini failed too -> local fallback vectors.
    assert len(out) == 2
    assert all(len(vec) == rag_service.DIM for vec in out)


def test_post_embedding_retries_once_on_429(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda *_a, **_k: None)
    calls = []

    def fake_post(url, **kwargs):
        calls.append(url)
        return _FakeEmbedResp(429 if len(calls) == 1 else 200)

    monkeypatch.setattr(rag_service.requests, "post", fake_post)
    resp = rag_service._post_embedding("https://example.invalid/embed", {})
    assert resp.status_code == 200
    assert len(calls) == 2


def test_index_stale_on_gemini_dim_mismatch(sample_course, monkeypatch):
    rag_service.build_index()
    monkeypatch.setattr(rag_service, "embedding_mode", lambda: "gemini")
    db.session.query(KnowledgeChunk).update(
        {"embedding_mode": "gemini", "embedding_dim": 768})
    db.session.commit()
    # 768-dim (text-embedding-004 cũ) không dùng chung với 3072-dim.
    assert rag_service._index_is_stale() is True
    db.session.query(KnowledgeChunk).update({"embedding_dim": 3072})
    db.session.commit()
    assert rag_service._index_is_stale() is False


def test_search_backend_is_python_on_sqlite(sample_course):
    rag_service.build_index()
    assert rag_service.search_backend() == "python"
    assert rag_service.vector_chunks() == 0

"""RAG service — index course content, retrieve what is relevant to a question.

Flow: ``build_index()`` chunks every published lesson and its exercises and
stores an embedding per chunk (table ``knowledge_chunks``). ``retrieve()``
embeds the learner's question and ranks chunks by cosine similarity —
the AI tutor then receives the top chunks as grounded context.

Embedder modes (``embedding_mode()``):

- ``gemini`` — ``GEMINI_API_KEY`` is set: call the Gemini embedding REST API
  (``gemini-embedding-001``; model ``text-embedding-004`` trước đây đã bị
  Google gỡ bỏ — gọi là 404). Any request failure falls back to the local
  embedder for that call so chat never dies because embeddings are down.
- ``local`` — deterministic hashing vectorizer (256 dims, word 1-2 grams +
  char 3-grams over diacritic-folded text, L2-normalized). No network, no
  model files; good enough to ground the stub/small-corpus case and to keep
  tests fully offline.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import unicodedata

import requests

from ..extensions import db
from ..models.course import Course
from ..models.learning import Exercise, Lesson
from ..models.rag import KnowledgeChunk

logger = logging.getLogger(__name__)

DIM = 256
GEMINI_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-embedding-001:embedContent"
)
# Score floors: local hashing vectors are noisier than Gemini's, so the
# local threshold is lower; both were picked to keep obvious matches and
# drop unrelated chatter.
THRESHOLDS = {"local": 0.05, "gemini": 0.3}


# ---------------------------------------------------------------------------
# Embedder
# ---------------------------------------------------------------------------
def embedding_mode() -> str:
    return "gemini" if os.getenv("GEMINI_API_KEY", "").strip() else "local"


def embed(text: str) -> list[float]:
    """Embed one text; Gemini when configured, local fallback otherwise."""
    if embedding_mode() == "gemini":
        try:
            return _embed_gemini(text)
        except Exception:
            logger.warning("Gemini embedding failed — falling back to local embedder",
                           exc_info=True)
    return _embed_local(text)


def _embed_gemini(text: str) -> list[float]:
    resp = requests.post(
        GEMINI_EMBED_URL,
        # Key đi qua header, không để trong URL (URL dễ lọt vào log).
        headers={"x-goog-api-key": os.getenv("GEMINI_API_KEY", "").strip()},
        json={"content": {"parts": [{"text": text or ""}]}},
        timeout=20,
    )
    resp.raise_for_status()
    values = resp.json()["embedding"]["values"]
    return _normalize([float(v) for v in values])


def _fold(text: str) -> str:
    """Lowercase + strip Vietnamese diacritics for tokenization."""
    text = (text or "").lower().replace("đ", "d")
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def _features(text: str) -> list[str]:
    folded = _fold(text)
    words = re.findall(r"[a-z0-9]+", folded)
    feats = list(words)
    feats += [f"{a} {b}" for a, b in zip(words, words[1:])]  # word 2-grams
    compact = " ".join(words)
    feats += [compact[i:i + 3] for i in range(max(0, len(compact) - 2))]  # char 3-grams
    return feats


def _embed_local(text: str) -> list[float]:
    vec = [0.0] * DIM
    for feat in _features(text):
        digest = hashlib.md5(feat.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:4], "little") % DIM
        sign = 1.0 if digest[4] % 2 == 0 else -1.0  # signed hashing reduces collisions
        vec[idx] += sign
    return _normalize(vec)


def _normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0:
        return vec
    return [v / norm for v in vec]


def _cosine(a: list[float], b: list[float]) -> float:
    # Both sides are L2-normalized at embed time, so cosine == dot product.
    return sum(x * y for x, y in zip(a, b))


# ---------------------------------------------------------------------------
# Indexing
# ---------------------------------------------------------------------------
def build_index() -> dict:
    """Rebuild the whole index from published content. Idempotent."""
    mode = embedding_mode()
    rows: list[KnowledgeChunk] = []

    def _chunk(source_type, source_id, course_id, title, content):
        vec = embed(content)
        return KnowledgeChunk(
            source_type=source_type, source_id=source_id,
            course_id=course_id, title=title, content=content,
            embedding=json.dumps(vec),
            embedding_mode=mode, embedding_dim=len(vec))

    courses = Course.query.filter_by(is_published=True).all()
    for course in courses:
        for unit in course.units:
            for lesson in unit.lessons:
                prefix = (f"Khóa: {course.title} — Chương: {unit.title} "
                          f"— Bài: {lesson.title}")
                lesson_content = "\n".join(
                    part for part in [prefix, lesson.title, lesson.description or ""]
                    if part)
                rows.append(_chunk("lesson", lesson.id, course.id,
                                   lesson.title, lesson_content))
                for ex in lesson.exercises:
                    lines = [prefix, f"Câu hỏi: {ex.question}",
                             f"Đáp án đúng: {ex.correct_answer}"]
                    if ex.explanation:
                        lines.append(f"Giải thích: {ex.explanation}")
                    content = "\n".join(lines)
                    rows.append(_chunk("exercise", ex.id, course.id,
                                       (ex.question or "")[:200], content))
    db.session.query(KnowledgeChunk).delete()
    # Bulk delete không gỡ object cũ khỏi identity map; expunge để các row
    # mới (có thể trùng PK) không đè lên object đã load trong session.
    db.session.expunge_all()
    db.session.add_all(rows)
    db.session.commit()
    return {"chunks": len(rows), "mode": mode}


def _index_is_stale() -> bool:
    """True khi index trống hoặc được build bằng embedder khác hiện tại."""
    chunks = KnowledgeChunk.query.with_entities(
        KnowledgeChunk.embedding_mode, KnowledgeChunk.embedding_dim).all()
    if not chunks:
        return True
    mode = embedding_mode()
    for stored_mode, stored_dim in chunks:
        if stored_mode is not None and stored_mode != mode:
            return True
        if (stored_dim is not None and mode == "local"
                and stored_dim != DIM):
            return True
    return False


def build_if_needed() -> dict:
    """Build (lại) index khi trống hoặc lỗi thời — chỉ gọi ở bước seed/deploy
    hoặc lệnh CLI, KHÔNG gọi trong request chat (xem retrieve)."""
    if _index_is_stale():
        result = build_index()
        result["rebuilt"] = True
        return result
    return {"chunks": KnowledgeChunk.query.count(),
            "mode": embedding_mode(), "rebuilt": False}


# ---------------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------------
def retrieve(query: str, top_k: int = 4, course_id: int | None = None) -> list[dict]:
    """Tìm chunk liên quan — KHÔNG build index ở đây.

    Trước đây retrieve() gọi build_if_empty() nên request chat đầu tiên
    sau deploy phải chờ build toàn bộ index đồng bộ (embedding từng chunk).
    Giờ index được build ở bước seed/deploy (``flask seed`` gọi
    build_if_needed, hoặc ``flask rag-index`` / POST /admin/rag/reindex);
    nếu index trống hoặc lỗi thời, retrieve chỉ trả rỗng và chat vẫn chạy
    bình thường (không có ngữ cảnh tài liệu).
    """
    if not (query or "").strip():
        return []
    q = KnowledgeChunk.query
    if course_id is not None:
        q = q.filter_by(course_id=course_id)
    chunks = q.all()
    if not chunks:
        return []
    mode = embedding_mode()
    query_vec = embed(query)
    threshold = THRESHOLDS[mode]
    scored = []
    for chunk in chunks:
        # Bỏ chunk build bằng embedder khác (mode/dim không khớp): vector
        # khác không gian thì cosine vô nghĩa.
        if chunk.embedding_mode is not None and chunk.embedding_mode != mode:
            continue
        if (chunk.embedding_dim is not None
                and chunk.embedding_dim != len(query_vec)):
            continue
        try:
            vec = json.loads(chunk.embedding or "[]")
        except (TypeError, ValueError):
            continue
        if len(vec) != len(query_vec):
            continue  # indexed under a different embedder/dimension
        score = _cosine(query_vec, vec)
        if score > threshold:
            scored.append({
                "title": chunk.title, "content": chunk.content,
                "source_type": chunk.source_type, "source_id": chunk.source_id,
                "score": round(score, 4),
            })
    scored.sort(key=lambda r: r["score"], reverse=True)
    return scored[:top_k]

"""RAG service — index course content, retrieve what is relevant to a question.

Flow: ``build_index()`` chunks every published lesson and its exercises and
stores an embedding per chunk (table ``knowledge_chunks``). ``retrieve()``
embeds the learner's question and ranks chunks by cosine similarity —
the AI tutor then receives the top chunks as grounded context.

Storage (two layers, same rows):

- ``embedding`` (JSON text) — works on every backend, incl. SQLite
  (dev/tests); the fallback search path.
- ``embedding_vec`` (pgvector ``vector(3072)``, Postgres/Neon only) —
  searched with one exact SQL query (no index: HNSW/IVFFlat cap at 2000
  dims, these vectors are 3072-dim; exact scan is sub-millisecond at
  this corpus size) instead of loading every chunk and running a
  Python cosine loop. Only Gemini embeddings go here; the local
  embedder (256 dims) keeps the JSON path.

Embedder modes (``embedding_mode()``):

- ``gemini`` — ``GEMINI_API_KEY`` is set: call the Gemini embedding REST API
  (``gemini-embedding-001``; model ``text-embedding-004`` trước đây đã bị
  Google gỡ bỏ — gọi là 404). ``outputDimensionality`` is pinned to 3072 so
  a future Google default change cannot silently break the index. Indexing
  embeds in batches (``batchEmbedContents``, 100 texts/call) instead of one
  HTTP call per chunk. Any request failure falls back to the local
  embedder for that call so chat never dies because embeddings are down.
- ``local`` — deterministic hashing vectorizer (256 dims, word 1-2 grams +
  char 3-grams over diacritic-folded text, L2-normalized). No network, no
  model files; good enough to ground the stub/small-corpus case and to keep
  tests fully offline.

Caching (per-process, in-memory): query embeddings (TTL 1h) and retrieval
results (TTL 10 min) are cached so repeated questions skip the embedding
API call and the search entirely. Both caches are cleared whenever the
index is rebuilt.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import time
import unicodedata
from collections import OrderedDict

import requests
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import defer

from ..extensions import db
from ..models.course import Course
from ..models.learning import Exercise, Lesson
from ..models.rag import GEMINI_DIM, KnowledgeChunk

logger = logging.getLogger(__name__)

DIM = 256
GEMINI_MODEL = "gemini-embedding-001"
GEMINI_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:embedContent"
)
GEMINI_BATCH_EMBED_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:batchEmbedContents"
)
# Score floors: local hashing vectors are noisier than Gemini's, so the
# local threshold is lower; both were picked to keep obvious matches and
# drop unrelated chatter.
THRESHOLDS = {"local": 0.05, "gemini": 0.3}

# Cache limits: embeddings are 3072 floats (~24 KB as Python floats, more
# as objects) so the caps stay small; retrieval results are short dicts.
_EMBED_CACHE_TTL = 3600.0
_EMBED_CACHE_MAX = 500
_RETRIEVE_CACHE_TTL = 600.0
_RETRIEVE_CACHE_MAX = 200
_VECTOR_CHECK_TTL = 60.0

_embed_cache: OrderedDict = OrderedDict()
_retrieve_cache: OrderedDict = OrderedDict()
_vector_check = {"at": 0.0, "value": False}


def _cache_get(cache: OrderedDict, key, ttl: float):
    entry = cache.get(key)
    if entry is None:
        return None
    value, expires_at = entry
    if time.monotonic() > expires_at:
        cache.pop(key, None)
        return None
    cache.move_to_end(key)
    return value


def _cache_put(cache: OrderedDict, key, value, ttl: float, max_items: int):
    cache[key] = (value, time.monotonic() + ttl)
    cache.move_to_end(key)
    while len(cache) > max_items:
        cache.popitem(last=False)


def clear_caches():
    """Drop embedding + retrieval caches and the vector-path probe.

    Called whenever the index is rebuilt so stale vectors/results can
    never be served after a reindex.
    """
    _embed_cache.clear()
    _retrieve_cache.clear()
    _vector_check["at"] = 0.0
    _vector_check["value"] = False


# ---------------------------------------------------------------------------
# Embedder
# ---------------------------------------------------------------------------
def embedding_mode() -> str:
    return "gemini" if os.getenv("GEMINI_API_KEY", "").strip() else "local"


def _post_embedding(url: str, payload: dict):
    """POST to the Gemini embedding API with one short retry on 429/503.

    Free-tier embedding bursts fail transiently; a single 0.5s retry
    usually gets through. Anything else (or a second failure) raises via
    the caller's ``raise_for_status`` and the local fallback takes over.
    """
    last = None
    for attempt in range(2):
        last = requests.post(
            url,
            # Key đi qua header, không để trong URL (URL dễ lọt vào log).
            headers={"x-goog-api-key": os.getenv("GEMINI_API_KEY", "").strip()},
            json=payload,
            timeout=20,
        )
        if last.status_code not in (429, 503):
            return last
        if attempt == 0:
            time.sleep(0.5)
    return last


def embed(text: str) -> list[float]:
    """Embed one text; Gemini when configured, local fallback otherwise.

    Query embeddings are cached (same question twice = no second API call).
    """
    cache_key = (embedding_mode(), _fold(text or "").strip())
    cached = _cache_get(_embed_cache, cache_key, _EMBED_CACHE_TTL)
    if cached is not None:
        return list(cached)
    if embedding_mode() == "gemini":
        try:
            vec = _embed_gemini(text)
        except Exception:
            logger.warning("Gemini embedding failed — falling back to local embedder",
                           exc_info=True)
            vec = _embed_local(text)
    else:
        vec = _embed_local(text)
    _cache_put(_embed_cache, cache_key, list(vec),
               _EMBED_CACHE_TTL, _EMBED_CACHE_MAX)
    return vec


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed many texts — one batch API call per 100 texts in Gemini mode.

    Indexing used to make one HTTP call per chunk (59+ calls at seed time);
    batching cuts that to a single call and far fewer chances to hit a
    rate limit. A failed batch falls back to per-text embedding (which
    itself falls back to the local embedder), so one bad batch never
    aborts the whole index build.
    """
    if embedding_mode() != "gemini":
        return [_embed_local(t) for t in texts]
    out: list[list[float]] = []
    for start in range(0, len(texts), 100):
        batch = texts[start:start + 100]
        try:
            out.extend(_embed_batch_gemini(batch))
        except Exception:
            logger.warning("Gemini batch embedding failed — embedding "
                           "%d texts one by one", len(batch), exc_info=True)
            out.extend(embed(t) for t in batch)
    return out


def _embed_gemini(text: str) -> list[float]:
    resp = _post_embedding(GEMINI_EMBED_URL, {
        "content": {"parts": [{"text": text or ""}]},
        "outputDimensionality": GEMINI_DIM,
    })
    resp.raise_for_status()
    values = resp.json()["embedding"]["values"]
    return _normalize([float(v) for v in values])


def _embed_batch_gemini(texts: list[str]) -> list[list[float]]:
    resp = _post_embedding(GEMINI_BATCH_EMBED_URL, {
        "requests": [
            {"model": f"models/{GEMINI_MODEL}",
             "content": {"parts": [{"text": t or ""}]},
             "outputDimensionality": GEMINI_DIM}
            for t in texts
        ],
    })
    resp.raise_for_status()
    embeddings = resp.json()["embeddings"]
    if len(embeddings) != len(texts):
        raise ValueError(
            f"batch embedding returned {len(embeddings)} vectors "
            f"for {len(texts)} texts")
    return [_normalize([float(v) for v in e["values"]]) for e in embeddings]


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
# Vector search availability (Postgres/pgvector)
# ---------------------------------------------------------------------------
def _is_postgres() -> bool:
    try:
        return db.engine.dialect.name == "postgresql"
    except Exception:
        return False


def _vector_available() -> bool:
    """True when the pgvector path can be used: Postgres + column exists +
    at least one row carries a native vector. Probed at most once a minute
    (schema/data only change at deploy or reindex).
    """
    now = time.monotonic()
    if now - _vector_check["at"] < _VECTOR_CHECK_TTL:
        return _vector_check["value"]
    value = False
    if _is_postgres():
        try:
            columns = [c["name"] for c in
                       sa_inspect(db.engine).get_columns("knowledge_chunks")]
            if "embedding_vec" in columns:
                value = (db.session.query(KnowledgeChunk.id)
                         .filter(KnowledgeChunk.embedding_vec.isnot(None))
                         .first() is not None)
        except Exception:
            logger.warning("pgvector availability probe failed — "
                           "using JSON search", exc_info=True)
            value = False
    _vector_check["at"] = now
    _vector_check["value"] = value
    return value


def search_backend() -> str:
    """Which search path ``retrieve`` will take: ``pgvector`` or ``python``."""
    return ("pgvector" if embedding_mode() == "gemini" and _vector_available()
            else "python")


def vector_chunks() -> int | None:
    """Rows carrying a native vector (None when the column is unusable)."""
    try:
        return (KnowledgeChunk.query
                .filter(KnowledgeChunk.embedding_vec.isnot(None)).count())
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Indexing
# ---------------------------------------------------------------------------
def build_index() -> dict:
    """Rebuild the whole index from published content. Idempotent."""
    mode = embedding_mode()
    use_vector = _is_postgres() and mode == "gemini"

    pending = []

    def _collect(source_type, source_id, course_id, title, content):
        pending.append((source_type, source_id, course_id, title, content))

    courses = Course.query.filter_by(is_published=True).all()
    for course in courses:
        for unit in course.units:
            for lesson in unit.lessons:
                prefix = (f"Khóa: {course.title} — Chương: {unit.title} "
                          f"— Bài: {lesson.title}")
                lesson_content = "\n".join(
                    part for part in [prefix, lesson.title, lesson.description or ""]
                    if part)
                _collect("lesson", lesson.id, course.id,
                         lesson.title, lesson_content)
                for ex in lesson.exercises:
                    lines = [prefix, f"Câu hỏi: {ex.question}",
                             f"Đáp án đúng: {ex.correct_answer}"]
                    if ex.explanation:
                        lines.append(f"Giải thích: {ex.explanation}")
                    _collect("exercise", ex.id, course.id,
                             (ex.question or "")[:200], "\n".join(lines))
    # Một lần gọi batch cho toàn bộ nội dung thay vì 1 HTTP call/chunk.
    vectors = embed_batch([content for *_, content in pending])
    rows = []
    for (source_type, source_id, course_id, title, content), vec in zip(pending, vectors):
        chunk = KnowledgeChunk(
            source_type=source_type, source_id=source_id,
            course_id=course_id, title=title, content=content,
            embedding=json.dumps(vec),
            embedding_mode=mode, embedding_dim=len(vec))
        if use_vector and len(vec) == GEMINI_DIM:
            chunk.embedding_vec = vec
        rows.append(chunk)
    db.session.query(KnowledgeChunk).delete()
    # Bulk delete không gỡ object cũ khỏi identity map; expunge để các row
    # mới (có thể trùng PK) không đè lên object đã load trong session.
    db.session.expunge_all()
    db.session.add_all(rows)
    db.session.commit()
    clear_caches()
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
        if stored_dim is not None and mode == "local" and stored_dim != DIM:
            return True
        # Gemini: vector 768 dim (text-embedding-004 cũ) không dùng chung
        # được với 3072 dim (gemini-embedding-001) — lệch dim là build lại.
        if (stored_dim is not None and mode == "gemini"
                and stored_dim != GEMINI_DIM):
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
def _retrieve_pgvector(query_vec, top_k, course_id, threshold):
    """Một query SQL exact scan qua cột vector — không load toàn bộ chunk về Python."""
    distance = KnowledgeChunk.embedding_vec.cosine_distance(query_vec)
    q = (db.session.query(KnowledgeChunk, distance.label("distance"))
         .filter(KnowledgeChunk.embedding_vec.isnot(None))
         .filter(distance < 1.0 - threshold))
    if course_id is not None:
        q = q.filter(KnowledgeChunk.course_id == course_id)
    rows = q.order_by(distance).limit(top_k).all()
    return [{
        "title": chunk.title, "content": chunk.content,
        "source_type": chunk.source_type, "source_id": chunk.source_id,
        "score": round(1.0 - dist, 4),
    } for chunk, dist in rows]


def _retrieve_python(query_vec, top_k, course_id, mode):
    """Đường cũ: load chunk, parse JSON, cosine bằng Python.

    ``defer(embedding_vec)`` để đường này không bao giờ chạm tới cột
    vector — an toàn cả khi migration pgvector chưa chạy trên Postgres.
    """
    q = KnowledgeChunk.query.options(defer(KnowledgeChunk.embedding_vec))
    if course_id is not None:
        q = q.filter_by(course_id=course_id)
    chunks = q.all()
    if not chunks:
        return []
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


def retrieve(query: str, top_k: int = 4, course_id: int | None = None) -> list[dict]:
    """Tìm chunk liên quan — KHÔNG build index ở đây.

    Trước đây retrieve() gọi build_if_empty() nên request chat đầu tiên
    sau deploy phải chờ build toàn bộ index đồng bộ (embedding từng chunk).
    Giờ index được build ở bước seed/deploy (``flask seed`` gọi
    build_if_needed, hoặc ``flask rag-index`` / POST /admin/rag/reindex);
    nếu index trống hoặc lỗi thời, retrieve chỉ trả rỗng và chat vẫn chạy
    bình thường (không có ngữ cảnh tài liệu).

    Đường truy vấn: cache kết quả (10 phút) → embed câu hỏi (cache 1 giờ)
    → pgvector (Postgres, 1 query SQL exact scan) hoặc Python cosine
    (SQLite / khi cột vector chưa có dữ liệu).
    """
    if not (query or "").strip():
        return []
    mode = embedding_mode()
    cache_key = (mode, course_id, _fold(query).strip(), top_k)
    cached = _cache_get(_retrieve_cache, cache_key, _RETRIEVE_CACHE_TTL)
    if cached is not None:
        return [dict(hit) for hit in cached]
    query_vec = embed(query)
    if (mode == "gemini" and len(query_vec) == GEMINI_DIM
            and _vector_available()):
        try:
            hits = _retrieve_pgvector(query_vec, top_k, course_id,
                                      THRESHOLDS[mode])
        except Exception:
            logger.warning("pgvector retrieve failed — falling back to "
                           "Python search", exc_info=True)
            hits = _retrieve_python(query_vec, top_k, course_id, mode)
    else:
        hits = _retrieve_python(query_vec, top_k, course_id, mode)
    _cache_put(_retrieve_cache, cache_key, [dict(hit) for hit in hits],
               _RETRIEVE_CACHE_TTL, _RETRIEVE_CACHE_MAX)
    return hits

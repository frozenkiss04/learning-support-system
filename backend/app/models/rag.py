"""RAG knowledge index — chunks of course content with their embeddings.

One row per retrievable piece of learning content (a lesson summary or a
single exercise with its answer/explanation). The embedding is stored twice:

- ``embedding`` — JSON-encoded list of floats in a Text column. Works on
  every backend (SQLite dev/tests included) and is the fallback search path.
- ``embedding_vec`` — native ``vector`` column (pgvector) on Postgres/Neon,
  searched with one exact SQL query (``ORDER BY embedding_vec <=> :q``).
  Deliberately unindexed: pgvector's HNSW/IVFFlat indexes cap at 2000
  dimensions and these vectors are 3072-dim — with tens of chunks an
  exact scan is sub-millisecond anyway. On SQLite the same attribute maps
  to a plain Text column (never populated) so ``create_all()`` keeps working
  in dev/tests without pgvector.

Only Gemini embeddings (3072 dims) go into the vector column; the local
hashing embedder (256 dims) keeps using the JSON path. Retrieval picks the
vector path when the dialect is Postgres and the column holds data, and
falls back to in-Python cosine search otherwise.
"""
from datetime import datetime, timezone

from pgvector.sqlalchemy import Vector

from ..extensions import db

# gemini-embedding-001 default output size (pinned explicitly in the embed
# request so a future Google default change cannot silently break the index).
GEMINI_DIM = 3072


class KnowledgeChunk(db.Model):
    __tablename__ = "knowledge_chunks"

    id = db.Column(db.Integer, primary_key=True)
    source_type = db.Column(db.String(20), nullable=False, index=True)  # lesson | exercise
    source_id = db.Column(db.Integer, nullable=False, index=True)
    course_id = db.Column(db.Integer, nullable=True, index=True)
    title = db.Column(db.String(300), nullable=False, default="")
    content = db.Column(db.Text, nullable=False)
    embedding = db.Column(db.Text, nullable=False)  # JSON list[float]
    # Native vector for pgvector ANN search on Postgres; plain Text (unused)
    # on SQLite so dev/tests need no pgvector.
    embedding_vec = db.Column(
        Vector(GEMINI_DIM).with_variant(db.Text, "sqlite"), nullable=True)
    # Embedder đã sinh vector này — để phát hiện index lỗi thời khi đổi mode
    # (local <-> gemini) hoặc đổi dim, rồi build lại ở bước seed/deploy.
    # NULL = chunk tạo trước khi có 2 cột này (chỉ còn kiểm tra bằng độ dài
    # vector khi retrieve).
    embedding_mode = db.Column(db.String(20), nullable=True)
    embedding_dim = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {"id": self.id, "source_type": self.source_type,
                "source_id": self.source_id, "course_id": self.course_id,
                "title": self.title, "content": self.content,
                "created_at": self.created_at.isoformat() if self.created_at else None}
    # Embedder đã sinh vector này — để phát hiện index lỗi thời khi đổi mode
    # (local <-> gemini) hoặc đổi dim, rồi build lại ở bước seed/deploy.
    # NULL = chunk tạo trước khi có 2 cột này (chỉ còn kiểm tra bằng độ dài
    # vector khi retrieve).
    embedding_mode = db.Column(db.String(20), nullable=True)
    embedding_dim = db.Column(db.Integer, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {"id": self.id, "source_type": self.source_type,
                "source_id": self.source_id, "course_id": self.course_id,
                "title": self.title, "content": self.content,
                "created_at": self.created_at.isoformat() if self.created_at else None}

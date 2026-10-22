"""RAG knowledge index — chunks of course content with their embeddings.

One row per retrievable piece of learning content (a lesson summary or a
single exercise with its answer/explanation). The embedding is stored as a
JSON-encoded list of floats in a Text column so the same schema works on
SQLite (dev/tests) and Postgres/Neon (production) with no pgvector
dependency; the corpus is small enough for in-Python cosine search.
"""
from datetime import datetime, timezone

from ..extensions import db


class KnowledgeChunk(db.Model):
    __tablename__ = "knowledge_chunks"

    id = db.Column(db.Integer, primary_key=True)
    source_type = db.Column(db.String(20), nullable=False, index=True)  # lesson | exercise
    source_id = db.Column(db.Integer, nullable=False, index=True)
    course_id = db.Column(db.Integer, nullable=True, index=True)
    title = db.Column(db.String(300), nullable=False, default="")
    content = db.Column(db.Text, nullable=False)
    embedding = db.Column(db.Text, nullable=False)  # JSON list[float]
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {"id": self.id, "source_type": self.source_type,
                "source_id": self.source_id, "course_id": self.course_id,
                "title": self.title, "content": self.content,
                "created_at": self.created_at.isoformat() if self.created_at else None}

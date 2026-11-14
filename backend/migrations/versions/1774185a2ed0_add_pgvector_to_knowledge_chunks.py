"""add pgvector column to knowledge_chunks

Revision ID: 1774185a2ed0
Revises: fb50cbedbc88
Create Date: 2026-11-14

Why: retrieval used to load every chunk, JSON-parse its embedding and run a
Python cosine loop per chat turn. With pgvector the same search becomes one
SQL query (``ORDER BY embedding_vec <=> :q LIMIT k``), which is what the
tutor agent's retrieve step uses on Postgres/Neon.

Postgres only — on SQLite (dev/tests) this migration is a no-op and the
model maps ``embedding_vec`` to a plain Text column instead.

- ``CREATE EXTENSION IF NOT EXISTS vector`` — pgvector is available on
  Neon; the database owner can create it.
- Backfill copies the JSON embedding into the vector column, but only for
  rows whose stored dimension matches the column (3072, gemini-embedding-
  001). Rows built by the local embedder (256 dims) or by an older Gemini
  model (768 dims) keep the JSON path; ``_index_is_stale`` now also flags
  a Gemini dimension mismatch, so the next ``flask seed`` rebuilds those
  rows with the current embedder (and fills the vector column).
- NO index on the vector column, on purpose: pgvector's HNSW/IVFFlat
  indexes cap at 2000 dimensions and our vectors are 3072-dim (a deploy
  failed on exactly this: "column cannot have more than 2000 dimensions
  for hnsw index"). With tens of chunks an exact scan is sub-millisecond,
  so the index buys nothing at this scale. If the corpus ever grows past
  thousands of chunks, switch to halfvec or a lower output dimension
  before adding an index.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '1774185a2ed0'
down_revision = 'fb50cbedbc88'
branch_labels = None
depends_on = None

VECTOR_DIM = 3072


def _is_postgres():
    return op.get_bind().dialect.name == "postgresql"


def _column_exists(table, column):
    inspector = sa.inspect(op.get_bind())
    return any(c["name"] == column for c in inspector.get_columns(table))


def upgrade():
    if not _is_postgres():
        return
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    if not _column_exists("knowledge_chunks", "embedding_vec"):
        op.execute(
            "ALTER TABLE knowledge_chunks "
            f"ADD COLUMN embedding_vec vector({VECTOR_DIM})"
        )
    # Backfill: JSON text "[0.1, 0.2, ...]" casts directly to pgvector input
    # format. Only rows with the matching dimension are copied.
    op.execute(
        "UPDATE knowledge_chunks SET embedding_vec = embedding::vector "
        f"WHERE embedding_dim = {VECTOR_DIM} "
        "AND embedding_vec IS NULL AND embedding LIKE '[%'"
    )


def downgrade():
    if not _is_postgres():
        return
    if _column_exists("knowledge_chunks", "embedding_vec"):
        op.drop_column("knowledge_chunks", "embedding_vec")

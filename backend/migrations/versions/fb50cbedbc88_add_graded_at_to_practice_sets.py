"""add graded_at to ai_practice_sets

Revision ID: fb50cbedbc88
Revises: 9f1e2621d90e
Create Date: 2026-11-13

Why: ``GET /api/progress/summary`` computes ``today_xp`` (the "Mục tiêu
hôm nay" daily goal) from the practice-set XP, but ``AiPracticeSet`` had
no "graded on" column, so the query matched ``set_date`` (the day the set
was *generated*). A set generated one day and submitted the next therefore
counted towards no day's goal at all: on the submit day ``set_date`` was
yesterday, and on the generation day it was not graded yet. ``graded_at``
records the actual submit time (set by the conditional UPDATE in
``practice_submit``), and ``_today_xp`` now buckets practice XP by
``date(graded_at)``.

Backfill: rows already graded get ``graded_at = created_at`` — the closest
available approximation (generation time, not submit time). Rows whose
``created_at`` is NULL stay NULL; they are all from past days, so they
cannot affect any current ``today_xp`` anyway.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'fb50cbedbc88'
down_revision = '9f1e2621d90e'
branch_labels = None
depends_on = None


def _column_exists(table, column):
    inspector = sa.inspect(op.get_bind())
    return any(c["name"] == column for c in inspector.get_columns(table))


def upgrade():
    if not _column_exists("ai_practice_sets", "graded_at"):
        op.add_column("ai_practice_sets",
                      sa.Column("graded_at", sa.DateTime(), nullable=True))
    # Backfill already-graded sets from their generation time.
    op.execute(
        "UPDATE ai_practice_sets SET graded_at = created_at "
        "WHERE graded = true AND graded_at IS NULL "
        "AND created_at IS NOT NULL"
    )


def downgrade():
    if _column_exists("ai_practice_sets", "graded_at"):
        op.drop_column("ai_practice_sets", "graded_at")

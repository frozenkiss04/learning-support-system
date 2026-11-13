"""initial schema (idempotent)

Revision ID: 9f1e2621d90e
Revises:
Create Date: 2026-11-13 06:16:40.401553

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '9f1e2621d90e'
down_revision = None
branch_labels = None
depends_on = None


# --- Idempotency helpers ---------------------------------------------------
# Production (Neon) already has these tables: they were created by
# ``db.create_all()`` before Alembic was introduced, so there is no
# ``alembic_version`` row. A plain ``create_table`` would fail with
# "table already exists" and break the Render startCommand
# (``flask db upgrade && flask seed && gunicorn ...``). Every step below
# therefore checks first and only applies what is missing. The same
# migration also creates the full schema from scratch on an empty DB.
#
# Existing tables additionally need the schema delta between the old
# create_all() schema and the current models:
#   * knowledge_chunks: + embedding_mode, + embedding_dim
#   * ai_practice_sets: + unique constraint uq_practice_set_user_day
# Without the delta, ``flask seed`` (RAG index build) would crash on the
# missing columns, and the practice-set race fix (which relies on the
# unique constraint raising IntegrityError) would be silently defeated.


def _inspector():
    return sa.inspect(op.get_bind())


def _table_exists(name):
    return _inspector().has_table(name)


def _column_exists(table, column):
    return any(c["name"] == column for c in _inspector().get_columns(table))


def _index_exists(table, name):
    return any(i["name"] == name for i in _inspector().get_indexes(table))


def _unique_constraint_exists(table, name):
    return any(c["name"] == name
               for c in _inspector().get_unique_constraints(table))


def _create_index_if_missing(table, name, columns, unique=False):
    if not _index_exists(table, name):
        op.create_index(name, table, columns, unique=unique)


def _drop_index_if_exists(table, name):
    if _index_exists(table, name):
        op.drop_index(name, table_name=table)


def _add_column_if_missing(table, column):
    if not _column_exists(table, column.name):
        # Batch mode: SQLite cannot ADD COLUMN constraints the same way
        # Postgres does; batch mode works on both dialects.
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(column)


def _add_practice_set_unique_constraint():
    """Add uq_practice_set_user_day if the table lacks it.

    Deduplicates first (keeping the earliest row per user/day): the
    pre-fix code could create duplicate sets for the same user and day
    under concurrent requests, and the constraint cannot be built while
    duplicates exist.
    """
    if _unique_constraint_exists("ai_practice_sets",
                                 "uq_practice_set_user_day"):
        return
    op.execute(sa.text(
        "DELETE FROM ai_practice_sets WHERE id NOT IN ("
        "SELECT MIN(id) FROM ai_practice_sets GROUP BY user_id, set_date)"
    ))
    with op.batch_alter_table("ai_practice_sets", schema=None) as batch_op:
        batch_op.create_unique_constraint(
            "uq_practice_set_user_day", ["user_id", "set_date"])


def upgrade():
    if not _table_exists('knowledge_chunks'):
        op.create_table('knowledge_chunks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('source_type', sa.String(length=20), nullable=False),
        sa.Column('source_id', sa.Integer(), nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(length=300), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('embedding', sa.Text(), nullable=False),
        sa.Column('embedding_mode', sa.String(length=20), nullable=True),
        sa.Column('embedding_dim', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
    else:
        # Delta vs the pre-Alembic create_all() schema.
        _add_column_if_missing(
            'knowledge_chunks',
            sa.Column('embedding_mode', sa.String(length=20), nullable=True))
        _add_column_if_missing(
            'knowledge_chunks',
            sa.Column('embedding_dim', sa.Integer(), nullable=True))
    _create_index_if_missing('knowledge_chunks',
                             'ix_knowledge_chunks_course_id', ['course_id'])
    _create_index_if_missing('knowledge_chunks',
                             'ix_knowledge_chunks_source_id', ['source_id'])
    _create_index_if_missing('knowledge_chunks',
                             'ix_knowledge_chunks_source_type',
                             ['source_type'])

    if not _table_exists('users'):
        op.create_table('users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('full_name', sa.String(length=120), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('xp', sa.Integer(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('token_version', sa.Integer(), nullable=False),
        sa.Column('last_login_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
        )
    _create_index_if_missing('users', 'ix_users_email', ['email'],
                             unique=True)
    _create_index_if_missing('users', 'ix_users_xp', ['xp'])

    if not _table_exists('ai_practice_sets'):
        op.create_table('ai_practice_sets',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('set_date', sa.Date(), nullable=False),
        sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('graded', sa.Boolean(), nullable=False),
        sa.Column('xp_awarded', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'set_date', name='uq_practice_set_user_day')
        )
    else:
        # Delta vs the pre-Alembic create_all() schema.
        _add_practice_set_unique_constraint()
    _create_index_if_missing('ai_practice_sets',
                             'ix_ai_practice_sets_set_date', ['set_date'])
    _create_index_if_missing('ai_practice_sets',
                             'ix_ai_practice_sets_user_id', ['user_id'])

    if not _table_exists('chat_sessions'):
        op.create_table('chat_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('context_type', sa.String(length=20), nullable=False),
        sa.Column('context_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.String(length=200), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
    _create_index_if_missing('chat_sessions',
                             'ix_chat_sessions_user_id', ['user_id'])

    if not _table_exists('courses'):
        op.create_table('courses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('slug', sa.String(length=220), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('level', sa.String(length=20), nullable=True),
        sa.Column('is_published', sa.Boolean(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
    _create_index_if_missing('courses', 'ix_courses_slug', ['slug'],
                             unique=True)

    if not _table_exists('streaks'):
        op.create_table('streaks',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('current_streak', sa.Integer(), nullable=False),
        sa.Column('longest_streak', sa.Integer(), nullable=False),
        sa.Column('last_study_date', sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('user_id')
        )

    if not _table_exists('token_blocklist'):
        op.create_table('token_blocklist',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('jti', sa.String(length=36), nullable=False),
        sa.Column('token_type', sa.String(length=20), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
    _create_index_if_missing('token_blocklist',
                             'ix_token_blocklist_jti', ['jti'], unique=True)
    _create_index_if_missing('token_blocklist',
                             'ix_token_blocklist_user_id', ['user_id'])

    if not _table_exists('user_quest_claims'):
        op.create_table('user_quest_claims',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('quest_date', sa.Date(), nullable=False),
        sa.Column('xp_awarded', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'quest_date', name='uq_user_quest_claim_day')
        )
    _create_index_if_missing('user_quest_claims',
                             'ix_user_quest_claims_user_id', ['user_id'])

    if not _table_exists('chat_messages'):
        op.create_table('chat_messages',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['session_id'], ['chat_sessions.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    if not _table_exists('units'):
        op.create_table('units',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    if not _table_exists('lessons'):
        op.create_table('lessons',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('unit_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.Column('xp_reward', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['unit_id'], ['units.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    if not _table_exists('exercises'):
        op.create_table('exercises',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lesson_id', sa.Integer(), nullable=False),
        sa.Column('type', sa.String(length=30), nullable=False),
        sa.Column('question', sa.Text(), nullable=False),
        sa.Column('options', sa.JSON(), nullable=True),
        sa.Column('correct_answer', sa.Text(), nullable=False),
        sa.Column('explanation', sa.Text(), nullable=True),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['lesson_id'], ['lessons.id'], ),
        sa.PrimaryKeyConstraint('id')
        )

    if not _table_exists('user_progress'):
        op.create_table('user_progress',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('lesson_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('score', sa.Integer(), nullable=False),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['lesson_id'], ['lessons.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'lesson_id')
        )
    _create_index_if_missing('user_progress',
                             'ix_user_progress_user_id', ['user_id'])

    if not _table_exists('attempts'):
        op.create_table('attempts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('exercise_id', sa.Integer(), nullable=False),
        sa.Column('answer', sa.Text(), nullable=True),
        sa.Column('is_correct', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['exercise_id'], ['exercises.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
        )
    _create_index_if_missing('attempts', 'ix_attempts_user_id', ['user_id'])

    if not _table_exists('review_cards'):
        op.create_table('review_cards',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('exercise_id', sa.Integer(), nullable=False),
        sa.Column('ease_factor', sa.Float(), nullable=False),
        sa.Column('interval_days', sa.Integer(), nullable=False),
        sa.Column('repetitions', sa.Integer(), nullable=False),
        sa.Column('next_review_at', sa.DateTime(), nullable=False),
        sa.Column('last_result', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['exercise_id'], ['exercises.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'exercise_id', name='uq_review_card_user_exercise')
        )
    _create_index_if_missing('review_cards',
                             'ix_review_cards_exercise_id', ['exercise_id'])
    _create_index_if_missing('review_cards',
                             'ix_review_cards_next_review_at',
                             ['next_review_at'])
    _create_index_if_missing('review_cards',
                             'ix_review_cards_user_id', ['user_id'])


def downgrade():
    _drop_index_if_exists('review_cards', 'ix_review_cards_user_id')
    _drop_index_if_exists('review_cards', 'ix_review_cards_next_review_at')
    _drop_index_if_exists('review_cards', 'ix_review_cards_exercise_id')
    if _table_exists('review_cards'):
        op.drop_table('review_cards')

    _drop_index_if_exists('attempts', 'ix_attempts_user_id')
    if _table_exists('attempts'):
        op.drop_table('attempts')

    _drop_index_if_exists('user_progress', 'ix_user_progress_user_id')
    if _table_exists('user_progress'):
        op.drop_table('user_progress')

    if _table_exists('exercises'):
        op.drop_table('exercises')
    if _table_exists('lessons'):
        op.drop_table('lessons')
    if _table_exists('units'):
        op.drop_table('units')
    if _table_exists('chat_messages'):
        op.drop_table('chat_messages')

    _drop_index_if_exists('user_quest_claims', 'ix_user_quest_claims_user_id')
    if _table_exists('user_quest_claims'):
        op.drop_table('user_quest_claims')

    _drop_index_if_exists('token_blocklist', 'ix_token_blocklist_user_id')
    _drop_index_if_exists('token_blocklist', 'ix_token_blocklist_jti')
    if _table_exists('token_blocklist'):
        op.drop_table('token_blocklist')

    if _table_exists('streaks'):
        op.drop_table('streaks')

    _drop_index_if_exists('courses', 'ix_courses_slug')
    if _table_exists('courses'):
        op.drop_table('courses')

    _drop_index_if_exists('chat_sessions', 'ix_chat_sessions_user_id')
    if _table_exists('chat_sessions'):
        op.drop_table('chat_sessions')

    _drop_index_if_exists('ai_practice_sets', 'ix_ai_practice_sets_user_id')
    _drop_index_if_exists('ai_practice_sets', 'ix_ai_practice_sets_set_date')
    if _table_exists('ai_practice_sets'):
        op.drop_table('ai_practice_sets')

    _drop_index_if_exists('users', 'ix_users_xp')
    _drop_index_if_exists('users', 'ix_users_email')
    if _table_exists('users'):
        op.drop_table('users')

    _drop_index_if_exists('knowledge_chunks',
                          'ix_knowledge_chunks_source_type')
    _drop_index_if_exists('knowledge_chunks',
                          'ix_knowledge_chunks_source_id')
    _drop_index_if_exists('knowledge_chunks',
                          'ix_knowledge_chunks_course_id')
    if _table_exists('knowledge_chunks'):
        op.drop_table('knowledge_chunks')

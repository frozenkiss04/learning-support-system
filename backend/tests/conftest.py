"""Shared fixtures for the backend test suite.

Design rules for the whole suite:

- Every test gets a brand-new Flask app backed by its own temporary SQLite
  file (pytest ``tmp_path``), so tests are fully independent and can run in
  any order. Nothing touches the dev database or Neon.
- The AI provider keys are stripped from the environment *before* the app
  package is imported, because ``app.blueprints.ai_chat`` instantiates
  ``AiService`` at import time. Tests therefore always exercise the AI stub
  mode and never call a real provider.
- Sample learning content (course / unit / lesson / exercises) is built
  directly through the models in fixtures here — tests never depend on the
  ``flask seed`` CLI or on seed data.
"""
import os
import sys
from pathlib import Path

# --- Force AI stub mode before importing the app package -------------------
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("OPENAI_API_KEY", None)
os.environ.pop("OPENROUTER_API_KEY", None)
os.environ["AI_PROVIDER"] = "gemini"
os.environ.pop("DATABASE_URL", None)

# Make ``import app`` work no matter where pytest is invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from app import create_app  # noqa: E402
from app.config import Config  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models.course import Course, Unit  # noqa: E402
from app.models.learning import Exercise, Lesson  # noqa: E402
from app.models.user import ROLE_ADMIN, ROLE_LEARNER, User  # noqa: E402

LEARNER_EMAIL = "learner@example.com"
LEARNER_PASSWORD = "Learner@123"
ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "Admin@12345"


class TestConfig(Config):
    TESTING = True
    SECRET_KEY = "test-secret-key"
    JWT_SECRET_KEY = "test-jwt-secret-key"
    # Keep engine options SQLite-friendly (the production config sets
    # Postgres pool sizes that the SQLite dialect does not accept).
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}
    # The API has per-route rate limits (e.g. AI chat 30/hour); tests share
    # one remote address, so limiter state would leak between test cases.
    RATELIMIT_ENABLED = False


@pytest.fixture()
def app(tmp_path):
    db_file = tmp_path / "test.db"

    class _Cfg(TestConfig):
        SQLALCHEMY_DATABASE_URI = f"sqlite:///{db_file}"

    flask_app = create_app(_Cfg)
    ctx = flask_app.app_context()
    ctx.push()
    db.create_all()
    yield flask_app
    db.session.remove()
    db.drop_all()
    ctx.pop()


@pytest.fixture()
def client(app):
    return app.test_client()


# ---------------------------------------------------------------------------
# Users and auth helpers
# ---------------------------------------------------------------------------

def _make_user(email, password, full_name, role):
    user = User(email=email, full_name=full_name, role=role)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return user


def _login(client, email, password):
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()["data"]


@pytest.fixture()
def learner(app):
    return _make_user(LEARNER_EMAIL, LEARNER_PASSWORD, "Học Viên Mẫu", ROLE_LEARNER)


@pytest.fixture()
def admin(app):
    return _make_user(ADMIN_EMAIL, ADMIN_PASSWORD, "Quản Trị Viên", ROLE_ADMIN)


@pytest.fixture()
def learner_token(client, learner):
    return _login(client, LEARNER_EMAIL, LEARNER_PASSWORD)["access_token"]


@pytest.fixture()
def admin_token(client, admin):
    return _login(client, ADMIN_EMAIL, ADMIN_PASSWORD)["access_token"]


@pytest.fixture()
def learner_headers(learner_token):
    return {"Authorization": f"Bearer {learner_token}"}


@pytest.fixture()
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------------------------------------------------------------------------
# Sample learning content (built via models, never via the seed CLI)
# ---------------------------------------------------------------------------

@pytest.fixture()
def sample_course(app):
    """One published course + one unpublished draft.

    Published course: 1 unit, 1 lesson (xp_reward=10) with 3 exercises.
    Returns a plain dict of ids/answers so tests never touch detached ORM
    objects.
    """
    course = Course(
        title="Tiếng Anh giao tiếp A1",
        slug="english-a1-test",
        description="Khóa nền tảng cho người mới bắt đầu.",
        level="A1",
        is_published=True,
    )
    draft = Course(
        title="Khóa nháp chưa xuất bản",
        slug="draft-course-test",
        description="",
        level="A2",
        is_published=False,
    )
    db.session.add_all([course, draft])
    db.session.flush()

    unit = Unit(course_id=course.id, title="Chào hỏi và giới thiệu", order_index=1)
    db.session.add(unit)
    db.session.flush()

    lesson = Lesson(
        unit_id=unit.id,
        title="Hello and introductions",
        description="Chào hỏi, giới thiệu tên.",
        order_index=1,
        xp_reward=10,
    )
    db.session.add(lesson)
    db.session.flush()

    exercises = [
        Exercise(
            lesson_id=lesson.id, type="MULTIPLE_CHOICE",
            question="Chọn câu chào đúng vào buổi sáng:",
            options=["Good night", "Good morning", "Goodbye", "Thank you"],
            correct_answer="Good morning",
            explanation="Buổi sáng dùng Good morning.", order_index=1,
        ),
        Exercise(
            lesson_id=lesson.id, type="FILL_BLANK",
            question="Điền từ: My ___ is Anna.",
            correct_answer="name",
            explanation="My name is ... dùng để giới thiệu tên.", order_index=2,
        ),
        Exercise(
            lesson_id=lesson.id, type="MULTIPLE_CHOICE",
            question="\"Nice to meet you\" nghĩa là gì?",
            options=["Rất vui được gặp bạn", "Tạm biệt", "Cảm ơn bạn", "Xin lỗi"],
            correct_answer="Rất vui được gặp bạn",
            explanation="Câu chào khi mới gặp lần đầu.", order_index=3,
        ),
    ]
    db.session.add_all(exercises)
    db.session.commit()

    return {
        "course_id": course.id,
        "course_slug": course.slug,
        "draft_course_id": draft.id,
        "draft_slug": draft.slug,
        "unit_id": unit.id,
        "lesson_id": lesson.id,
        "lesson_xp": lesson.xp_reward,
        "exercise_ids": [e.id for e in exercises],
        # Correct submission exactly as a client would send it (JSON object
        # keys are always strings).
        "correct_answers": {str(e.id): e.correct_answer for e in exercises},
        "wrong_answers": {str(e.id): "__sai__" for e in exercises},
    }

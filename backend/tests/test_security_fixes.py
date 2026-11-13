"""Hồi quy cho các lỗi bảo mật / race condition sửa ngày 2026-11-13.

Mỗi test tương ứng một lỗi trong báo cáo QA:
#1 SRS lộ đáp án, #2 submit vào khóa chưa xuất bản, #3 nộp trượt lộ đáp
án, #4 race practice/generate, #5 race practice/submit, #6 ProxyFix,
#7 seed admin fail-closed, #9 health 503 khi DB chết, #11b logout thu
hồi cả cặp token, streak hiển thị, error handler JSON, RAG không build
đồng bộ trong request.
"""
from datetime import date, datetime, timedelta
from unittest import mock

import pytest
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.extensions import db
from app.models.course import Unit
from app.models.learning import Attempt, Exercise, Lesson, Streak
from app.models.practice import AiPracticeSet
from app.models.rag import KnowledgeChunk
from app.models.review import ReviewCard
from app.services import rag_service


def _draft_lesson(app, sample_course):
    """1 bài học có 1 bài tập trong khóa NHÁP (chưa xuất bản)."""
    unit = Unit(course_id=sample_course["draft_course_id"],
                title="Chương nháp", order_index=1)
    db.session.add(unit)
    db.session.flush()
    lesson = Lesson(unit_id=unit.id, title="Bài nháp", description="",
                    order_index=1, xp_reward=10)
    db.session.add(lesson)
    db.session.flush()
    exercise = Exercise(lesson_id=lesson.id, type="FILL_BLANK",
                        question="Điền từ: Hello ___.", correct_answer="world",
                        explanation="Hello world.", order_index=1)
    db.session.add(exercise)
    db.session.commit()
    return {"lesson_id": lesson.id, "exercise_id": exercise.id,
            "correct": {str(exercise.id): "world"}}


def _submit(client, lesson_id, answers, headers):
    return client.post(f"/api/lessons/{lesson_id}/submit",
                       json={"answers": answers}, headers=headers)


# ---------------------------------------------------------------------------
# #1 — SRS review lộ đáp án
# ---------------------------------------------------------------------------

def test_review_without_attempt_is_forbidden(client, sample_course, learner_headers):
    """Chưa từng làm bài tập thì không được tạo thẻ SRS cho nó."""
    exercise_id = sample_course["exercise_ids"][0]
    resp = client.post(f"/api/progress/review/{exercise_id}",
                       json={"is_correct": True}, headers=learner_headers)
    assert resp.status_code == 403
    assert ReviewCard.query.count() == 0  # không tạo thẻ lén


def test_review_with_attempt_ok(client, sample_course, learner_headers):
    _submit(client, sample_course["lesson_id"],
            sample_course["correct_answers"], learner_headers)
    exercise_id = sample_course["exercise_ids"][0]
    resp = client.post(f"/api/progress/review/{exercise_id}",
                       json={"is_correct": True}, headers=learner_headers)
    assert resp.status_code == 200


def test_due_never_returns_correct_answer(client, sample_course, learner_headers):
    # Nộp trượt: thẻ SRS lapse nên đến hạn ngay -> xuất hiện trong /due.
    _submit(client, sample_course["lesson_id"],
            sample_course["wrong_answers"], learner_headers)
    resp = client.get("/api/progress/due", headers=learner_headers)
    assert resp.status_code == 200
    cards = resp.get_json()["data"]
    assert len(cards) == 3
    for card in cards:
        assert "correct_answer" not in card["exercise"]
        assert "explanation" not in card["exercise"]
        assert card["exercise"]["question"]  # câu hỏi vẫn có để ôn


def test_due_returns_answer_only_for_completed_lessons(client, app, sample_course,
                                                      learner, learner_headers):
    # Nộp đạt (>=80%): bài đã hoàn thành nên /due kèm đáp án để lật thẻ ôn.
    _submit(client, sample_course["lesson_id"],
            sample_course["correct_answers"], learner_headers)
    # Thẻ sau khi nộp đạt được lên lịch tương lai -> đưa về quá khứ để đến hạn.
    ReviewCard.query.filter_by(user_id=learner.id).update(
        {"next_review_at": datetime(2020, 1, 1)})
    db.session.commit()
    resp = client.get("/api/progress/due", headers=learner_headers)
    assert resp.status_code == 200
    cards = resp.get_json()["data"]
    assert len(cards) == 3
    for card in cards:
        assert card["exercise"]["correct_answer"]
        assert "explanation" in card["exercise"]


def test_due_excludes_unpublished_course_cards(client, app, sample_course,
                                               learner, learner_headers):
    draft = _draft_lesson(app, sample_course)
    db.session.add(Attempt(user_id=learner.id, exercise_id=draft["exercise_id"],
                           answer="world", is_correct=True))
    db.session.add(ReviewCard(user_id=learner.id,
                              exercise_id=draft["exercise_id"]))
    db.session.commit()
    resp = client.get("/api/progress/due", headers=learner_headers)
    assert resp.status_code == 200
    assert resp.get_json()["data"] == []


def test_review_unpublished_course_is_404_for_learner(client, app, sample_course,
                                                     learner, learner_headers):
    draft = _draft_lesson(app, sample_course)
    db.session.add(Attempt(user_id=learner.id, exercise_id=draft["exercise_id"],
                           answer="world", is_correct=True))
    db.session.commit()
    resp = client.post(f"/api/progress/review/{draft['exercise_id']}",
                       json={"is_correct": True}, headers=learner_headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# #2 — Submit vào khóa chưa xuất bản
# ---------------------------------------------------------------------------

def test_submit_unpublished_lesson_returns_404(client, app, sample_course,
                                               learner_headers):
    draft = _draft_lesson(app, sample_course)
    resp = _submit(client, draft["lesson_id"], draft["correct"], learner_headers)
    assert resp.status_code == 404
    assert Attempt.query.count() == 0  # không chấm, không ghi attempt


def test_submit_unpublished_lesson_allowed_for_admin(client, app, sample_course,
                                                     admin_headers):
    draft = _draft_lesson(app, sample_course)
    resp = _submit(client, draft["lesson_id"], draft["correct"], admin_headers)
    assert resp.status_code == 200
    assert resp.get_json()["data"]["passed"] is True


# ---------------------------------------------------------------------------
# #3 — Nộp trượt lộ đáp án
# ---------------------------------------------------------------------------

def test_failing_submit_hides_answers(client, sample_course, learner_headers):
    resp = _submit(client, sample_course["lesson_id"],
                   sample_course["wrong_answers"], learner_headers)
    data = resp.get_json()["data"]
    assert data["passed"] is False
    for detail in data["details"]:
        assert "correct_answer" not in detail
        assert "explanation" not in detail
        assert "is_correct" in detail


def test_failing_after_completed_lesson_reveals_answers(client, sample_course,
                                                        learner_headers):
    # Đã từng hoàn thành bài -> nộp lại (dù trượt) vẫn được xem đáp án để ôn.
    first = _submit(client, sample_course["lesson_id"],
                    sample_course["correct_answers"], learner_headers)
    assert first.get_json()["data"]["passed"] is True
    second = _submit(client, sample_course["lesson_id"],
                     sample_course["wrong_answers"], learner_headers)
    data = second.get_json()["data"]
    assert data["passed"] is False
    for detail in data["details"]:
        assert detail["correct_answer"]
        assert "explanation" in detail


# ---------------------------------------------------------------------------
# #4 — Race practice/generate: unique (user_id, set_date)
# ---------------------------------------------------------------------------

def test_practice_set_unique_per_user_per_day(app, learner):
    today = date.today()
    db.session.add(AiPracticeSet(user_id=learner.id, set_date=today,
                                 payload='{"exercises": []}'))
    db.session.commit()
    db.session.add(AiPracticeSet(user_id=learner.id, set_date=today,
                                 payload='{"exercises": []}'))
    with pytest.raises(IntegrityError):
        db.session.commit()
    db.session.rollback()
    assert AiPracticeSet.query.filter_by(user_id=learner.id).count() == 1


# ---------------------------------------------------------------------------
# #5 — Race practice/submit: UPDATE có điều kiện graded=false
# ---------------------------------------------------------------------------

def test_practice_claim_conditional_update_single_winner(app, learner):
    """Mô phỏng 2 transaction nộp song song: chỉ một claim được row."""
    practice_set = AiPracticeSet(user_id=learner.id, set_date=date.today(),
                                 payload='{"exercises": []}')
    db.session.add(practice_set)
    db.session.commit()

    def _claim(session):
        return session.execute(
            update(AiPracticeSet)
            .where(AiPracticeSet.id == practice_set.id,
                   AiPracticeSet.graded.is_(False))
            .values(graded=True, xp_awarded=20))

    other = Session(bind=db.engine)
    try:
        first = _claim(other)
        other.commit()
        assert first.rowcount == 1
        second = _claim(db.session)
        assert second.rowcount == 0  # bên thua không cập nhật được
        db.session.rollback()
    finally:
        other.close()
    assert db.session.get(AiPracticeSet, practice_set.id).graded is True


# ---------------------------------------------------------------------------
# #6 — ProxyFix
# ---------------------------------------------------------------------------

def test_proxy_fix_wrapped(app):
    from werkzeug.middleware.proxy_fix import ProxyFix

    assert isinstance(app.wsgi_app, ProxyFix)


# ---------------------------------------------------------------------------
# #7 — Seed admin fail-closed trên production
# ---------------------------------------------------------------------------

def test_seed_fails_closed_without_admin_password_in_production(
        app, monkeypatch):
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    result = app.test_cli_runner().invoke(args=["seed"])
    assert result.exit_code != 0
    assert "ADMIN_PASSWORD" in result.output


def test_seed_ok_in_production_with_admin_password(app, monkeypatch):
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("ADMIN_PASSWORD", "SeedTest@123456")
    result = app.test_cli_runner().invoke(args=["seed"])
    assert result.exit_code == 0, result.output


def test_seed_ok_without_admin_password_outside_production(app, monkeypatch):
    monkeypatch.setenv("FLASK_ENV", "development")
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    result = app.test_cli_runner().invoke(args=["seed"])
    assert result.exit_code == 0, result.output


# ---------------------------------------------------------------------------
# #9 — Health 503 khi DB chết
# ---------------------------------------------------------------------------

def test_health_returns_503_when_database_down(client):
    with mock.patch.object(db.session, "execute",
                           side_effect=Exception("connection refused")):
        resp = client.get("/health")
    assert resp.status_code == 503
    assert resp.get_json()["success"] is False


# ---------------------------------------------------------------------------
# #11b — Logout thu hồi cả cặp token
# ---------------------------------------------------------------------------

def _login_pair(client):
    resp = client.post("/api/auth/login", json={
        "email": "learner@example.com", "password": "Learner@123"})
    assert resp.status_code == 200
    return resp.get_json()["data"]


def test_logout_with_refresh_token_revokes_both(client, learner):
    pair = _login_pair(client)
    resp = client.post(
        "/api/auth/logout",
        json={"refresh_token": pair["refresh_token"]},
        headers={"Authorization": f"Bearer {pair['access_token']}"})
    assert resp.status_code == 200
    assert resp.get_json()["data"]["refresh_revoked"] is True

    # Access cũ bị thu hồi...
    me = client.get("/api/auth/me",
                    headers={"Authorization": f"Bearer {pair['access_token']}"})
    assert me.status_code == 401
    # ...và refresh cũng không cấp được access mới nữa.
    refresh = client.post(
        "/api/auth/refresh",
        headers={"Authorization": f"Bearer {pair['refresh_token']}"})
    assert refresh.status_code == 401


def test_logout_without_refresh_token_still_works(client, learner):
    pair = _login_pair(client)
    resp = client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {pair['access_token']}"})
    assert resp.status_code == 200
    assert resp.get_json()["data"]["refresh_revoked"] is False
    # Client cũ không gửi refresh: refresh vẫn sống (hành vi cũ được giữ).
    refresh = client.post(
        "/api/auth/refresh",
        headers={"Authorization": f"Bearer {pair['refresh_token']}"})
    assert refresh.status_code == 200


def test_logout_ignores_other_users_refresh_token(client, learner, admin):
    pair = _login_pair(client)
    admin_pair = client.post("/api/auth/login", json={
        "email": "admin@example.com", "password": "Admin@12345"})
    admin_refresh = admin_pair.get_json()["data"]["refresh_token"]
    resp = client.post(
        "/api/auth/logout",
        json={"refresh_token": admin_refresh},
        headers={"Authorization": f"Bearer {pair['access_token']}"})
    assert resp.status_code == 200
    assert resp.get_json()["data"]["refresh_revoked"] is False
    # Refresh của admin không bị thu hồi bởi learner.
    refresh = client.post(
        "/api/auth/refresh",
        headers={"Authorization": f"Bearer {admin_refresh}"})
    assert refresh.status_code == 200


# ---------------------------------------------------------------------------
# Streak hiển thị đúng (chỉ lúc đọc, không sửa DB)
# ---------------------------------------------------------------------------

def test_me_shows_zero_streak_after_gap(client, learner, learner_headers):
    db.session.add(Streak(user_id=learner.id, current_streak=7,
                          longest_streak=7,
                          last_study_date=date.today() - timedelta(days=5)))
    db.session.commit()
    resp = client.get("/api/auth/me", headers=learner_headers)
    data = resp.get_json()["data"]
    assert data["current_streak"] == 0
    assert data["streak"]["current_streak"] == 0
    assert data["streak"]["longest_streak"] == 7  # longest không đổi
    # DB không bị sửa:
    assert db.session.get(Streak, learner.id).current_streak == 7


def test_me_keeps_streak_from_yesterday(client, learner, learner_headers):
    db.session.add(Streak(user_id=learner.id, current_streak=7,
                          longest_streak=7,
                          last_study_date=date.today() - timedelta(days=1)))
    db.session.commit()
    resp = client.get("/api/auth/me", headers=learner_headers)
    assert resp.get_json()["data"]["current_streak"] == 7


def test_leaderboard_shows_zero_streak_after_gap(client, learner, learner_headers):
    db.session.add(Streak(user_id=learner.id, current_streak=7,
                          longest_streak=7,
                          last_study_date=date.today() - timedelta(days=5)))
    db.session.commit()
    resp = client.get("/api/leaderboard", headers=learner_headers)
    entry = [e for e in resp.get_json()["data"] if e["id"] == learner.id][0]
    assert entry["current_streak"] == 0


# ---------------------------------------------------------------------------
# Global JSON error handler
# ---------------------------------------------------------------------------

def test_unknown_route_returns_json_error(client):
    resp = client.get("/api/this-route-does-not-exist")
    assert resp.status_code == 404
    body = resp.get_json()
    assert body["success"] is False
    assert body["error"]["message"]


def test_wrong_method_returns_json_error(client):
    resp = client.post("/health")
    assert resp.status_code == 405
    assert resp.get_json()["success"] is False


def test_rate_limit_breach_returns_json_error(client):
    """429 cũng phải là JSON fail(...) thay vì HTML.

    Flask-Limiter ném HTTPException 429 khi vượt giới hạn, đi qua đúng
    errorhandler này; ở đây ép 429 bằng abort (limiter bị tắt toàn cục
    trong test nên không ép breach thật được).
    """
    from flask import abort

    def _breach():
        abort(429)

    # Không dùng fixture login: thêm route sau request đầu sẽ bị cấm.
    client.application.add_url_rule(
        "/_test_429_probe", endpoint="_test_429_probe",
        view_func=_breach, methods=["GET"])
    resp = client.get("/_test_429_probe")
    assert resp.status_code == 429
    body = resp.get_json()
    assert body["success"] is False
    assert body["error"]["message"]


# ---------------------------------------------------------------------------
# RAG: không build đồng bộ trong request; mode/dim kèm chunk
# ---------------------------------------------------------------------------

def test_retrieve_with_empty_index_returns_empty_without_building(sample_course):
    assert KnowledgeChunk.query.count() == 0
    assert rag_service.retrieve("Good morning") == []
    assert KnowledgeChunk.query.count() == 0  # không tự build trong request


def test_build_index_records_embedding_mode_and_dim(sample_course):
    rag_service.build_index()
    chunk = KnowledgeChunk.query.first()
    assert chunk.embedding_mode == "local"
    assert chunk.embedding_dim == 256


def test_build_if_needed_rebuilds_when_mode_changes(sample_course):
    rag_service.build_index()
    assert rag_service.build_if_needed()["rebuilt"] is False
    chunk = KnowledgeChunk.query.first()
    chunk.embedding_mode = "gemini"  # giả lập index build bằng embedder khác
    db.session.commit()
    result = rag_service.build_if_needed()
    assert result["rebuilt"] is True
    assert result["mode"] == "local"
    assert KnowledgeChunk.query.first().embedding_mode == "local"


def test_retrieve_ignores_chunks_from_other_embedder(sample_course):
    rag_service.build_index()
    assert rag_service.retrieve("Good morning là câu chào vào buổi sáng")
    db.session.query(KnowledgeChunk).update({"embedding_mode": "gemini"})
    db.session.commit()
    assert rag_service.retrieve("Good morning là câu chào vào buổi sáng") == []

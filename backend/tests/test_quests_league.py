"""Daily quests + weekly league: GET/POST /api/progress/quests(/claim),
GET /api/progress/weekly-league.

Quest progress is derived from today's real activity (UTC day): lesson
completions (UserProgress.completed_at), review cards worked on
(ReviewCard.updated_at) and graded answers (Attempt). The claim bonus is
+30 XP, once per day. League XP sums Lesson.xp_reward over lessons
completed since Monday 00:00 UTC.
"""
from datetime import date, datetime, timezone

from app.extensions import db
from app.models.learning import Attempt, Exercise, Lesson, UserProgress
from app.models.review import ReviewCard
from app.models.user import ROLE_LEARNER, User


def _submit(client, sample_course, headers):
    return client.post(
        f"/api/lessons/{sample_course['lesson_id']}/submit",
        json={"answers": sample_course["correct_answers"]},
        headers=headers,
    )


def _quests_by_key(client, headers):
    resp = client.get("/api/progress/quests", headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    return data, {q["key"]: q for q in data["quests"]}


def test_quests_and_league_require_auth(client):
    assert client.get("/api/progress/quests").status_code == 401
    assert client.post("/api/progress/quests/claim").status_code == 401
    assert client.get("/api/progress/weekly-league").status_code == 401


def test_quests_initial_state(client, learner_headers):
    data, quests = _quests_by_key(client, learner_headers)
    assert data["date"] == datetime.now(timezone.utc).date().isoformat()
    assert data["claim_xp"] == 30
    assert data["all_done"] is False
    assert data["claimed"] is False
    assert quests["lesson"] == {
        "key": "lesson", "title": "Hoàn thành 1 bài học",
        "target": 1, "progress": 0, "done": False,
    }
    assert quests["review"]["target"] == 5 and quests["review"]["progress"] == 0
    assert quests["practice"]["target"] == 10 and quests["practice"]["progress"] == 0


def test_quests_progress_after_one_passing_submit(client, sample_course, learner_headers):
    _submit(client, sample_course, learner_headers)

    data, quests = _quests_by_key(client, learner_headers)
    # Lesson quest completes with the single passed lesson.
    assert quests["lesson"]["progress"] == 1
    assert quests["lesson"]["done"] is True
    # 3 exercises graded -> 3 attempts today; grading also creates/touches
    # one review card per exercise.
    assert quests["practice"]["progress"] == 3
    assert quests["practice"]["done"] is False
    assert quests["review"]["progress"] == 3
    assert data["all_done"] is False


def test_claim_rejected_until_all_quests_done(client, sample_course, learner_headers):
    resp = client.post("/api/progress/quests/claim", headers=learner_headers)
    assert resp.status_code == 400

    _submit(client, sample_course, learner_headers)  # only some quests done
    resp = client.post("/api/progress/quests/claim", headers=learner_headers)
    assert resp.status_code == 400


def test_claim_success_awards_30_xp_once(client, sample_course, learner, learner_headers):
    _submit(client, sample_course, learner_headers)

    # Top up today's activity directly: +7 attempts (10 total) and review
    # cards for 2 extra exercises (5 distinct cards touched today).
    extra_exercises = []
    for idx in (4, 5):
        ex = Exercise(
            lesson_id=sample_course["lesson_id"], type="MULTIPLE_CHOICE",
            question=f"Câu bổ sung {idx}", options=["A", "B"],
            correct_answer="A", explanation="", order_index=idx,
        )
        db.session.add(ex)
        extra_exercises.append(ex)
    db.session.flush()
    for ex in extra_exercises:
        db.session.add(ReviewCard(user_id=learner.id, exercise_id=ex.id))
    for ex_id in sample_course["exercise_ids"] * 2 + sample_course["exercise_ids"][:1]:
        db.session.add(Attempt(user_id=learner.id, exercise_id=ex_id,
                               answer="A", is_correct=True))
    db.session.commit()

    data, _ = _quests_by_key(client, learner_headers)
    assert data["all_done"] is True
    assert data["claimed"] is False

    resp = client.post("/api/progress/quests/claim", headers=learner_headers)
    assert resp.status_code == 200
    claim = resp.get_json()["data"]
    assert claim["xp_awarded"] == 30
    assert claim["xp"] == sample_course["lesson_xp"] + 30

    data, _ = _quests_by_key(client, learner_headers)
    assert data["claimed"] is True

    resp = client.post("/api/progress/quests/claim", headers=learner_headers)
    assert resp.status_code == 409


def test_weekly_league_before_any_study(client, learner_headers):
    resp = client.get("/api/progress/weekly-league", headers=learner_headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["my_weekly_xp"] == 0
    assert data["tier"] is None
    # Sole member of the ranking pool (earners + current user) -> rank 1.
    assert data["my_rank"] == 1
    assert date.fromisoformat(data["week_start"]).weekday() == 0  # Monday


def test_weekly_league_after_submit(client, sample_course, learner_headers):
    _submit(client, sample_course, learner_headers)

    resp = client.get("/api/progress/weekly-league", headers=learner_headers)
    data = resp.get_json()["data"]
    assert data["my_weekly_xp"] == sample_course["lesson_xp"]
    assert data["my_rank"] == 1
    assert data["tier"] == "Vàng"
    mine = [e for e in data["entries"] if e["is_me"]]
    assert len(mine) == 1
    assert mine[0]["weekly_xp"] == sample_course["lesson_xp"]
    assert mine[0]["rank"] == data["my_rank"]
    assert mine[0]["full_name"]


def test_weekly_league_orders_by_weekly_xp(client, sample_course, learner, learner_headers):
    _submit(client, sample_course, learner_headers)

    # A second learner completes a pricier lesson this week -> ranks above.
    other = User(email="other@example.com", full_name="Học Viên Khác", role=ROLE_LEARNER)
    other.set_password("Other@123")
    db.session.add(other)
    db.session.flush()
    pricey = Lesson(
        unit_id=sample_course["unit_id"], title="Bài nâng cao",
        description="", order_index=2, xp_reward=25,
    )
    db.session.add(pricey)
    db.session.flush()
    db.session.add(UserProgress(
        user_id=other.id, lesson_id=pricey.id, status="COMPLETED",
        score=100, completed_at=datetime.now(timezone.utc),
    ))
    db.session.commit()

    resp = client.get("/api/progress/weekly-league", headers=learner_headers)
    data = resp.get_json()["data"]
    assert [e["weekly_xp"] for e in data["entries"]] == [25, sample_course["lesson_xp"]]
    assert data["entries"][0]["full_name"] == "Học Viên Khác"
    assert data["entries"][0]["is_me"] is False
    assert data["my_rank"] == 2
    assert data["tier"] == "Vàng"  # rank 2 is still in the 1-3 band

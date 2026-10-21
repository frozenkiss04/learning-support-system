"""Lesson submission / grading: POST /api/lessons/<id>/submit.

Grading contract (services/progress_service.grade_lesson):
score = percent correct, passed at >= 80, XP awarded exactly once,
progress row persisted, streak touched on a pass.
"""


def _submit(client, sample_course, answers, headers):
    return client.post(
        f"/api/lessons/{sample_course['lesson_id']}/submit",
        json={"answers": answers},
        headers=headers,
    )


def test_submit_all_correct_scores_100_and_awards_xp(client, sample_course, learner_headers):
    resp = _submit(client, sample_course, sample_course["correct_answers"], learner_headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["total"] == 3
    assert data["correct"] == 3
    assert data["score"] == 100
    assert data["passed"] is True
    assert data["xp_earned"] == sample_course["lesson_xp"]
    assert len(data["details"]) == 3
    assert all(d["is_correct"] for d in data["details"])


def test_submit_all_wrong_scores_zero_and_no_xp(client, sample_course, learner_headers):
    resp = _submit(client, sample_course, sample_course["wrong_answers"], learner_headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["correct"] == 0
    assert data["score"] == 0
    assert data["passed"] is False
    assert data["xp_earned"] == 0


def test_submit_partial_below_80_percent_does_not_pass(client, sample_course, learner_headers):
    answers = dict(sample_course["correct_answers"])
    one_id = str(sample_course["exercise_ids"][0])
    answers[one_id] = "__sai__"  # 2/3 correct = 67% < 80% threshold
    resp = _submit(client, sample_course, answers, learner_headers)
    data = resp.get_json()["data"]
    assert data["correct"] == 2
    assert data["score"] == 67
    assert data["passed"] is False
    assert data["xp_earned"] == 0


def test_submit_details_reveal_answers_only_after_submit(client, sample_course, learner_headers):
    resp = _submit(client, sample_course, sample_course["correct_answers"], learner_headers)
    details = {d["exercise_id"]: d for d in resp.get_json()["data"]["details"]}
    for exercise_id, correct in sample_course["correct_answers"].items():
        detail = details[int(exercise_id)]
        assert detail["correct_answer"] == correct
        assert detail["explanation"]  # explanation is part of the feedback


def test_xp_awarded_only_once_on_resubmit(client, sample_course, learner_headers):
    first = _submit(client, sample_course, sample_course["correct_answers"], learner_headers)
    assert first.get_json()["data"]["xp_earned"] == sample_course["lesson_xp"]

    second = _submit(client, sample_course, sample_course["correct_answers"], learner_headers)
    assert second.get_json()["data"]["xp_earned"] == 0

    me = client.get("/api/auth/me", headers=learner_headers)
    assert me.get_json()["data"]["xp"] == sample_course["lesson_xp"]


def test_passing_marks_lesson_completed_on_path(client, sample_course, learner_headers):
    _submit(client, sample_course, sample_course["correct_answers"], learner_headers)
    path = client.get(f"/api/courses/{sample_course['course_id']}/path",
                      headers=learner_headers)
    lesson = path.get_json()["data"]["units"][0]["lessons"][0]
    assert lesson["status"] == "COMPLETED"
    assert lesson["score"] == 100


def test_failing_does_not_mark_lesson_completed(client, sample_course, learner_headers):
    _submit(client, sample_course, sample_course["wrong_answers"], learner_headers)
    path = client.get(f"/api/courses/{sample_course['course_id']}/path",
                      headers=learner_headers)
    lesson = path.get_json()["data"]["units"][0]["lessons"][0]
    assert lesson["status"] == "AVAILABLE"


def test_passing_starts_a_streak(client, sample_course, learner_headers):
    me_before = client.get("/api/auth/me", headers=learner_headers)
    assert me_before.get_json()["data"]["current_streak"] == 0

    _submit(client, sample_course, sample_course["correct_answers"], learner_headers)

    me_after = client.get("/api/auth/me", headers=learner_headers)
    assert me_after.get_json()["data"]["current_streak"] == 1


def test_grading_is_case_insensitive(client, sample_course, learner_headers):
    lowered = {k: v.lower() for k, v in sample_course["correct_answers"].items()}
    resp = _submit(client, sample_course, lowered, learner_headers)
    assert resp.get_json()["data"]["score"] == 100


def test_submit_requires_auth(client, sample_course):
    resp = client.post(
        f"/api/lessons/{sample_course['lesson_id']}/submit",
        json={"answers": sample_course["correct_answers"]},
    )
    assert resp.status_code == 401


def test_submit_unknown_lesson_returns_404(client, learner_headers):
    resp = client.post("/api/lessons/999999/submit",
                       json={"answers": {}}, headers=learner_headers)
    assert resp.status_code == 404

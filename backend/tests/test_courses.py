"""Courses blueprint: list, learning path, lesson detail, leaderboard."""


def test_list_courses_returns_only_published(client, sample_course):
    resp = client.get("/api/courses")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    slugs = [c["slug"] for c in body["data"]]
    assert sample_course["course_slug"] in slugs
    assert sample_course["draft_slug"] not in slugs  # unpublished stays hidden


def test_list_courses_empty_when_nothing_published(client):
    resp = client.get("/api/courses")
    assert resp.status_code == 200
    assert resp.get_json()["data"] == []


def test_learning_path_structure_for_anonymous(client, sample_course):
    resp = client.get(f"/api/courses/{sample_course['course_id']}/path")
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["course"]["id"] == sample_course["course_id"]
    assert len(data["units"]) == 1

    unit = data["units"][0]
    assert unit["id"] == sample_course["unit_id"]
    assert len(unit["lessons"]) == 1

    lesson = unit["lessons"][0]
    assert lesson["id"] == sample_course["lesson_id"]
    assert lesson["status"] == "AVAILABLE"  # nothing completed yet
    assert lesson["xp_reward"] == sample_course["lesson_xp"]


def test_learning_path_with_token_starts_available(client, sample_course, learner_headers):
    resp = client.get(f"/api/courses/{sample_course['course_id']}/path",
                      headers=learner_headers)
    assert resp.status_code == 200
    lesson = resp.get_json()["data"]["units"][0]["lessons"][0]
    assert lesson["status"] == "AVAILABLE"
    assert lesson["score"] is None


def test_learning_path_unknown_course_returns_404(client):
    resp = client.get("/api/courses/999999/path")
    assert resp.status_code == 404


def test_lesson_detail_requires_auth(client, sample_course):
    resp = client.get(f"/api/lessons/{sample_course['lesson_id']}")
    assert resp.status_code == 401


def test_lesson_detail_returns_exercises_without_answers(client, sample_course, learner_headers):
    resp = client.get(f"/api/lessons/{sample_course['lesson_id']}",
                      headers=learner_headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["id"] == sample_course["lesson_id"]
    assert len(data["exercises"]) == len(sample_course["exercise_ids"])
    for exercise in data["exercises"]:
        assert exercise["question"]
        # Answers and explanations must never leak to learners pre-submit.
        assert "correct_answer" not in exercise
        assert "explanation" not in exercise


def test_lesson_detail_unknown_lesson_returns_404(client, learner_headers):
    resp = client.get("/api/lessons/999999", headers=learner_headers)
    assert resp.status_code == 404


def test_leaderboard_requires_auth(client):
    assert client.get("/api/leaderboard").status_code == 401


def test_leaderboard_with_auth_returns_ranked_users(client, learner_headers, learner):
    resp = client.get("/api/leaderboard", headers=learner_headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert isinstance(data, list)
    assert any(row["id"] == learner.id for row in data)
    xps = [row["xp"] for row in data]
    assert xps == sorted(xps, reverse=True)

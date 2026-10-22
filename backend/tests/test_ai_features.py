"""Tính năng AI mới: bộ luyện tập cá nhân hóa, chat nhập vai, báo cáo tuần.

Môi trường test không có GEMINI_API_KEY (conftest đã gỡ) nên AiService ở chế
độ stub: generate phải fallback về ngân hàng câu hỏi ('bank') và
weekly-report phải fallback về template — cả hai đều dùng số liệu/câu hỏi
thật trong DB.
"""
import pytest

from app.extensions import db
from app.models.course import Course, Unit
from app.models.learning import Attempt, Exercise, Lesson
from app.models.practice import AiPracticeSet
from app.models.review import ReviewCard
from app.models.user import User


@pytest.fixture()
def practice_content(app, learner):
    """2 bài học x 3 bài tập + dấu hiệu điểm yếu của learner.

    Điểm yếu: 1 thẻ ôn đến hạn thuộc bài 1, 1 attempt sai gần đây thuộc bài 2.
    """
    course = Course(title="Khóa luyện tập", slug="practice-course",
                    description="", level="A1", is_published=True)
    db.session.add(course)
    db.session.flush()
    unit = Unit(course_id=course.id, title="Chương luyện tập", order_index=1)
    db.session.add(unit)
    db.session.flush()

    specs = [
        ("Chào hỏi cơ bản", [
            ("MULTIPLE_CHOICE", "Buổi sáng chào thế nào?",
             ["Good morning", "Good night", "Bye", "Thanks"],
             "Good morning", "Chào buổi sáng."),
            ("FILL_BLANK", "Điền từ: My ___ is Tom.", None,
             "name", "Giới thiệu tên."),
            ("MULTIPLE_CHOICE", "\"Thank you\" nghĩa là gì?",
             ["Cảm ơn", "Xin chào", "Tạm biệt", "Xin lỗi"],
             "Cảm ơn", "Lời cảm ơn."),
        ]),
        ("Gia đình", [
            ("MULTIPLE_CHOICE", "\"Mother\" nghĩa là gì?",
             ["Mẹ", "Bố", "Anh", "Em"], "Mẹ", "Mother = mẹ."),
            ("FILL_BLANK", "Điền từ: She is my ___.", None,
             "mother", "Mother = mẹ."),
            ("MULTIPLE_CHOICE", "\"Father\" nghĩa là gì?",
             ["Bố", "Mẹ", "Chú", "Bác"], "Bố", "Father = bố."),
        ]),
    ]
    lessons, exercises = [], {}
    for idx, (title, ex_specs) in enumerate(specs, start=1):
        lesson = Lesson(unit_id=unit.id, title=title,
                        description=f"Mô tả {title}", order_index=idx, xp_reward=10)
        db.session.add(lesson)
        db.session.flush()
        lessons.append(lesson)
        exercises[lesson.id] = []
        for j, (etype, question, options, answer, expl) in enumerate(ex_specs, start=1):
            ex = Exercise(lesson_id=lesson.id, type=etype, question=question,
                          options=options, correct_answer=answer,
                          explanation=expl, order_index=j)
            db.session.add(ex)
            exercises[lesson.id].append(ex)
    db.session.flush()
    db.session.add(ReviewCard(user_id=learner.id,
                              exercise_id=exercises[lessons[0].id][0].id))
    db.session.add(Attempt(user_id=learner.id,
                           exercise_id=exercises[lessons[1].id][0].id,
                           answer="__sai__", is_correct=False))
    db.session.commit()
    return {"lesson_ids": [lesson.id for lesson in lessons]}


# ---------------------------------------------------------------------------
# Practice generate
# ---------------------------------------------------------------------------

def test_practice_generate_fallback_bank_five_questions_no_answers(
        client, learner_headers, practice_content):
    resp = client.post("/api/ai/practice/generate", headers=learner_headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["set_id"]
    # Không có key trong môi trường test -> stub -> fallback ngân hàng câu hỏi.
    assert data["generated_by"] == "bank"
    assert len(data["exercises"]) == 5
    for ex in data["exercises"]:
        assert ex["question"]
        assert ex["type"] in ("MULTIPLE_CHOICE", "FILL_BLANK")
        assert "correct_answer" not in ex  # tuyệt đối không lộ đáp án
        assert "explanation" not in ex


def test_practice_generate_same_day_returns_same_set(
        client, learner_headers, practice_content):
    first = client.post("/api/ai/practice/generate", headers=learner_headers)
    second = client.post("/api/ai/practice/generate", headers=learner_headers)
    assert first.status_code == second.status_code == 200
    assert (first.get_json()["data"]["set_id"]
            == second.get_json()["data"]["set_id"])


def test_practice_generate_requires_auth(client, practice_content):
    resp = client.post("/api/ai/practice/generate")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Practice submit
# ---------------------------------------------------------------------------

def _answers_for(set_id, correct_count):
    """Đáp án: đúng `correct_count` câu đầu (theo payload đã lưu), còn lại sai."""
    practice_set = db.session.get(AiPracticeSet, set_id)
    answers = {}
    for idx, ex in enumerate(practice_set.exercises()):
        answers[str(ex["id"])] = ex["correct_answer"] if idx < correct_count else "__sai__"
    return answers


def test_practice_submit_grades_and_awards_xp(
        client, learner_headers, learner, practice_content):
    gen = client.post("/api/ai/practice/generate", headers=learner_headers)
    set_id = gen.get_json()["data"]["set_id"]
    xp_before = db.session.get(User, learner.id).xp

    resp = client.post("/api/ai/practice/submit", headers=learner_headers,
                       json={"set_id": set_id, "answers": _answers_for(set_id, 3)})
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["correct"] == 3
    assert data["total"] == 5
    assert data["xp_awarded"] == 12  # 4 XP x 3 câu đúng
    assert len(data["details"]) == 5
    assert sum(1 for d in data["details"] if d["is_correct"]) == 3
    # Sau khi nộp mới được xem đáp án + giải thích.
    assert all(d["correct_answer"] for d in data["details"])
    assert db.session.get(User, learner.id).xp == xp_before + 12

    again = client.post("/api/ai/practice/submit", headers=learner_headers,
                        json={"set_id": set_id, "answers": _answers_for(set_id, 5)})
    assert again.status_code == 409


def test_practice_submit_all_correct_max_20_xp(
        client, learner_headers, practice_content):
    gen = client.post("/api/ai/practice/generate", headers=learner_headers)
    set_id = gen.get_json()["data"]["set_id"]
    resp = client.post("/api/ai/practice/submit", headers=learner_headers,
                       json={"set_id": set_id, "answers": _answers_for(set_id, 5)})
    data = resp.get_json()["data"]
    assert data["correct"] == 5
    assert data["xp_awarded"] == 20


def test_practice_submit_other_users_set_returns_404(
        client, learner_headers, admin_headers, practice_content):
    gen = client.post("/api/ai/practice/generate", headers=learner_headers)
    set_id = gen.get_json()["data"]["set_id"]
    resp = client.post("/api/ai/practice/submit", headers=admin_headers,
                       json={"set_id": set_id, "answers": {}})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Roleplay chat
# ---------------------------------------------------------------------------

def test_roleplay_chat_cafe_returns_reply(client, learner_headers):
    resp = client.post("/api/ai/chat", headers=learner_headers, json={
        "message": "Hello, I want a coffee please",
        "context_type": "ROLEPLAY", "scenario": "cafe",
    })
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["reply"]
    assert data["context_type"] == "ROLEPLAY"

    # Lượt nối tiếp trong cùng session (không cần gửi lại scenario) vẫn chạy.
    second = client.post("/api/ai/chat", headers=learner_headers, json={
        "message": "A small one, please", "session_id": data["session_id"],
    })
    assert second.status_code == 200
    assert second.get_json()["data"]["session_id"] == data["session_id"]


def test_roleplay_chat_invalid_scenario_returns_400(client, learner_headers):
    resp = client.post("/api/ai/chat", headers=learner_headers, json={
        "message": "Xin chào", "context_type": "ROLEPLAY", "scenario": "spaceship",
    })
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False


def test_roleplay_chat_missing_scenario_returns_400(client, learner_headers):
    resp = client.post("/api/ai/chat", headers=learner_headers, json={
        "message": "Xin chào", "context_type": "ROLEPLAY",
    })
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Weekly report
# ---------------------------------------------------------------------------

def test_weekly_report_admin_ok(client, admin_headers, practice_content):
    resp = client.post("/api/admin/ai/weekly-report", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.get_json()["data"]
    assert data["week_label"]
    assert data["summary"]
    assert isinstance(data["insights"], list) and data["insights"]
    assert isinstance(data["suggestions"], list) and data["suggestions"]
    # Stub mode -> báo cáo template từ số liệu thật.
    assert data["generated_by"] == "template"
    stats = data["stats"]
    assert stats["total_learners"] >= 1
    assert stats["total_attempts"] >= 1  # attempt sai trong fixture
    assert "accuracy_percent" in stats


def test_weekly_report_forbidden_for_learner(client, learner_headers):
    resp = client.post("/api/admin/ai/weekly-report", headers=learner_headers)
    assert resp.status_code == 403

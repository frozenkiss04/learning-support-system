import re
from datetime import datetime, timezone

from sqlalchemy import func, update

from ..extensions import db
from ..models.learning import Attempt, Lesson, Streak, UserProgress
from ..models.user import User
from .srs_service import record_result as srs_record_result


def award_xp(user_id: int, amount: int) -> None:
    """Cộng XP nguyên tử: UPDATE ... SET xp = xp + :n (không đọc-sửa-ghi).

    Hai request nộp bài song song không còn ghi đè XP của nhau. Đối tượng
    User đã load trong session sẽ được làm mới ở lần commit tiếp theo
    (expire_on_commit), nên caller không được đọc user.xp ngay sau khi gọi
    hàm này mà chưa commit/flush-expire.
    """
    if not amount:
        return
    db.session.execute(
        update(User)
        .where(User.id == user_id)
        .values(xp=func.coalesce(User.xp, 0) + amount)
    )


def _normalize_answer(value) -> str:
    """Normalize a free-text answer for comparison.

    Learners type the same correct sentence with different casing, extra
    spaces, or a trailing period ("My name is Anna" vs the stored
    "My name is Anna.") — all of those must grade as correct.
    """
    text = str(value or "").strip().lower()
    text = re.sub(r"\s+", " ", text)
    return text.rstrip(" .!?,;:")


def grade_lesson(user, lesson: Lesson, answers: dict) -> dict:
    """Grade a submission, persist attempts, award XP once, update the streak.

    answers: {exercise_id: submitted_answer}

    Every graded answer also feeds the SRS schedule (see srs_service):
    a wrong answer makes the exercise's review card due again almost
    immediately, a correct one extends its interval following SM-2.
    The return contract is unchanged: {score, passed, correct, total,
    xp_earned, details}.
    """
    total = len(lesson.exercises)
    correct = 0
    details = []
    # Đáp án chỉ lộ khi bài nộp này ĐẠT, hoặc user đã từng hoàn thành bài
    # này trước đây (ôn lại). Nộp trượt không được thấy đáp án — nếu không
    # chỉ cần nộp sai là lấy được toàn bộ đáp án rồi nộp lại để đạt.
    progress = UserProgress.query.filter_by(user_id=user.id, lesson_id=lesson.id).first()
    previously_completed = progress is not None and progress.status == "COMPLETED"
    for ex in lesson.exercises:
        submitted = str(answers.get(str(ex.id), answers.get(ex.id, ""))).strip()
        is_correct = _normalize_answer(submitted) == _normalize_answer(ex.correct_answer)
        correct += int(is_correct)
        db.session.add(Attempt(user_id=user.id, exercise_id=ex.id,
                               answer=submitted, is_correct=is_correct))
        srs_record_result(user.id, ex.id, is_correct)
        details.append({"exercise_id": ex.id, "is_correct": is_correct})
    score = round(correct * 100 / total) if total else 0
    passed = score >= 80
    if passed or previously_completed:
        for detail, ex in zip(details, lesson.exercises):
            detail["correct_answer"] = ex.correct_answer
            detail["explanation"] = ex.explanation

    if not progress:
        progress = UserProgress(user_id=user.id, lesson_id=lesson.id)
        db.session.add(progress)
    xp_earned = 0
    if passed and progress.status != "COMPLETED":
        progress.status = "COMPLETED"
        progress.completed_at = datetime.now(timezone.utc)
        xp_earned = lesson.xp_reward
        award_xp(user.id, xp_earned)
    progress.score = max(progress.score or 0, score)

    if passed:
        streak = Streak.query.get(user.id)
        if streak is None:
            # Explicit zeroes: column defaults only materialise after a
            # flush, but touch() does arithmetic on them immediately.
            streak = Streak(user_id=user.id, current_streak=0, longest_streak=0)
            db.session.add(streak)
        streak.touch()
    db.session.commit()
    return {"score": score, "passed": passed, "correct": correct, "total": total,
            "xp_earned": xp_earned, "details": details}

import re
from datetime import datetime, timezone

from ..extensions import db
from ..models.learning import Attempt, Lesson, Streak, UserProgress
from .srs_service import record_result as srs_record_result


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
    for ex in lesson.exercises:
        submitted = str(answers.get(str(ex.id), answers.get(ex.id, ""))).strip()
        is_correct = _normalize_answer(submitted) == _normalize_answer(ex.correct_answer)
        correct += int(is_correct)
        db.session.add(Attempt(user_id=user.id, exercise_id=ex.id,
                               answer=submitted, is_correct=is_correct))
        srs_record_result(user.id, ex.id, is_correct)
        details.append({"exercise_id": ex.id, "is_correct": is_correct,
                        "correct_answer": ex.correct_answer, "explanation": ex.explanation})
    score = round(correct * 100 / total) if total else 0
    passed = score >= 80

    progress = UserProgress.query.filter_by(user_id=user.id, lesson_id=lesson.id).first()
    if not progress:
        progress = UserProgress(user_id=user.id, lesson_id=lesson.id)
        db.session.add(progress)
    xp_earned = 0
    if passed and progress.status != "COMPLETED":
        progress.status = "COMPLETED"
        progress.completed_at = datetime.now(timezone.utc)
        xp_earned = lesson.xp_reward
        user.xp += xp_earned
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

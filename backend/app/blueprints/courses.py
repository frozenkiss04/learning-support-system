"""Learner-facing courses / lessons / leaderboard endpoints.

Mounted at ``/api`` by the app factory, so routes here read ``/api/courses``,
``/api/lessons/<id>`` etc. All responses go through ``utils.responses`` and
lesson payloads never include ``Exercise.correct_answer`` — answers are only
revealed by the submit endpoint, after grading, via ``progress_service``.
"""
from flask import Blueprint, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import func

from ..extensions import db
from ..models.course import Course, Unit
from ..models.learning import (
    LESSON_AVAILABLE,
    LESSON_COMPLETED,
    LESSON_LOCKED,
    PROGRESS_COMPLETED,
    Lesson,
    UserProgress,
)
from ..models.user import ROLE_ADMIN, ROLE_TEACHER, User
from ..services.progress_service import grade_lesson
from ..utils.responses import fail, ok
from ..utils.security import current_user

courses_bp = Blueprint("courses", __name__)

STAFF_ROLES = (ROLE_ADMIN, ROLE_TEACHER)


def _ordered_units(course):
    return sorted(course.units, key=lambda u: (u.order_index, u.id))


def _ordered_lessons(unit):
    return sorted(unit.lessons, key=lambda l: (l.order_index, l.id))


def _flattened_lessons(course):
    """Every lesson of the course in learning-path order."""
    lessons = []
    for unit in _ordered_units(course):
        lessons.extend(_ordered_lessons(unit))
    return lessons


def _lesson_states(user, course):
    """Map lesson_id -> {"status": ..., "score": ...} for the learning path.

    Sequential rule: walking the path in order, a lesson is COMPLETED when
    the user has a completed progress row, the first not-yet-completed
    lesson is AVAILABLE, and everything after it is LOCKED. Anonymous
    visitors (no JWT) get the same shape with no completions, so the FE can
    render a preview path: first lesson AVAILABLE, the rest LOCKED.
    """
    lessons = _flattened_lessons(course)
    scores = {}
    completed_ids = set()
    if user is not None and lessons:
        lesson_ids = [lesson.id for lesson in lessons]
        rows = (UserProgress.query
                .filter_by(user_id=user.id)
                .filter(UserProgress.lesson_id.in_(lesson_ids))
                .all())
        for row in rows:
            scores[row.lesson_id] = row.score
            if row.status == PROGRESS_COMPLETED:
                completed_ids.add(row.lesson_id)

    states = {}
    unlocked = True
    for lesson in lessons:
        if lesson.id in completed_ids:
            status = LESSON_COMPLETED
        elif unlocked:
            status = LESSON_AVAILABLE
            unlocked = False
        else:
            status = LESSON_LOCKED
        states[lesson.id] = {"status": status, "score": scores.get(lesson.id)}
    return states


def _visible_course(course_id, user):
    """Return the course, or None when it must look non-existent (404).

    Unpublished courses are hidden from learners and anonymous visitors;
    teachers/admins can still preview them.
    """
    course = Course.query.get(course_id)
    if course is None:
        return None
    if not course.is_published and (user is None or user.role not in STAFF_ROLES):
        return None
    return course


@courses_bp.get("/courses")
def list_courses():
    """Published courses only, each with total unit / lesson counts."""
    query = Course.query.filter_by(is_published=True)
    level = (request.args.get("level") or "").strip()
    if level:
        query = query.filter_by(level=level.upper())
    q = (request.args.get("q") or "").strip()
    if q:
        query = query.filter(Course.title.ilike(f"%{q}%") | Course.description.ilike(f"%{q}%"))
    courses = query.order_by(Course.id).all()
    if not courses:
        return ok([])

    course_ids = [c.id for c in courses]
    unit_counts = dict(
        db.session.query(Unit.course_id, func.count(Unit.id))
        .filter(Unit.course_id.in_(course_ids))
        .group_by(Unit.course_id)
        .all()
    )
    lesson_counts = dict(
        db.session.query(Unit.course_id, func.count(Lesson.id))
        .join(Lesson, Lesson.unit_id == Unit.id)
        .filter(Unit.course_id.in_(course_ids))
        .group_by(Unit.course_id)
        .all()
    )
    return ok([
        c.to_dict(total_units=unit_counts.get(c.id, 0),
                  total_lessons=lesson_counts.get(c.id, 0))
        for c in courses
    ])


@courses_bp.get("/courses/<int:course_id>/path")
@jwt_required(optional=True)
def learning_path(course_id):
    """Units -> lessons tree with per-lesson state for the current user."""
    user = current_user() if get_jwt_identity() else None
    course = _visible_course(course_id, user)
    if course is None:
        return fail("Khóa học không tồn tại", 404)

    states = _lesson_states(user, course)
    units = []
    total_lessons = 0
    completed_lessons = 0
    next_lesson_id = None
    for unit in _ordered_units(course):
        lessons = []
        for lesson in _ordered_lessons(unit):
            state = states[lesson.id]
            total_lessons += 1
            if state["status"] == LESSON_COMPLETED:
                completed_lessons += 1
            elif state["status"] == LESSON_AVAILABLE and next_lesson_id is None:
                next_lesson_id = lesson.id
            lessons.append({
                "id": lesson.id, "title": lesson.title,
                "description": lesson.description,
                "order_index": lesson.order_index,
                "xp_reward": lesson.xp_reward,
                "total_exercises": len(lesson.exercises),
                "status": state["status"],
                "score": state["score"],
            })
        unit_data = unit.to_dict()
        unit_data["lessons"] = lessons
        units.append(unit_data)

    return ok({
        "course": course.to_dict(total_lessons=total_lessons),
        "units": units,
        "summary": {
            "total_lessons": total_lessons,
            "completed_lessons": completed_lessons,
            "progress_percent": round(completed_lessons * 100 / total_lessons) if total_lessons else 0,
            "next_lesson_id": next_lesson_id,
        },
    })


@courses_bp.get("/lessons/<int:lesson_id>")
@jwt_required()
def lesson_detail(lesson_id):
    """Lesson with its exercises — never including correct answers."""
    user = current_user()
    if user is None:
        return fail("Người dùng không tồn tại", 401)
    lesson = Lesson.query.get(lesson_id)
    if lesson is None:
        return fail("Bài học không tồn tại", 404)
    course = lesson.unit.course if lesson.unit else None
    if course is not None and not course.is_published and user.role not in STAFF_ROLES:
        return fail("Bài học không tồn tại", 404)

    data = lesson.to_dict(include_exercises=True)
    if lesson.unit is not None:
        data["unit"] = {"id": lesson.unit.id, "title": lesson.unit.title}
    if course is not None:
        data["course"] = {"id": course.id, "title": course.title, "slug": course.slug}
    return ok(data)


@courses_bp.post("/lessons/<int:lesson_id>/submit")
@jwt_required()
def submit_lesson(lesson_id):
    """Grade a submission via progress_service (XP + streak handled there).

    Body: ``{"answers": {"<exercise_id>": "<answer>", ...}}``.
    LOCKED on the learning path is a FE navigation rule; the API still
    grades direct submissions so retries / deep links keep working.
    """
    user = current_user()
    if user is None:
        return fail("Người dùng không tồn tại", 401)
    lesson = Lesson.query.get(lesson_id)
    if lesson is None:
        return fail("Bài học không tồn tại", 404)
    if not lesson.exercises:
        return fail("Bài học chưa có câu hỏi", 400)
    answers = (request.get_json(silent=True) or {}).get("answers")
    if not isinstance(answers, dict):
        return fail("Trường 'answers' phải là object {exercise_id: answer}", 400)
    result = grade_lesson(user, lesson, answers)
    return ok(result)


@courses_bp.get("/leaderboard")
@jwt_required()
def leaderboard():
    """Top learners by XP. ``?limit=`` is clamped to 1..100 (default 20)."""
    user = current_user()
    try:
        limit = int(request.args.get("limit", 20))
    except (TypeError, ValueError):
        limit = 20
    limit = min(max(limit, 1), 100)
    users = (User.query
             .filter_by(is_active=True)
             .order_by(User.xp.desc(), User.id.asc())
             .limit(limit)
             .all())
    return ok([
        {"rank": rank, "id": u.id, "full_name": u.full_name, "xp": u.xp,
         "current_streak": u.streak.current_streak if u.streak else 0,
         "is_current_user": user is not None and u.id == user.id}
        for rank, u in enumerate(users, start=1)
    ])

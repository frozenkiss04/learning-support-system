"""Admin / teacher management API.

Quyền truy cập:
- Đọc (stats, danh sách user, danh sách nội dung, weakest lessons):
  ADMIN hoặc TEACHER (``manager``).
- Ghi (tạo / sửa / xóa khóa học, chương, bài học, bài tập) và mọi thao tác
  trên tài khoản user (khóa / mở, đổi role): chỉ ADMIN.

Mọi lỗi đều trả qua ``utils/responses.fail`` với thông báo tiếng Việt.
"""
import re
from datetime import date, timedelta

from flask import Blueprint, request
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models.course import Course, Unit
from ..models.learning import EXERCISE_TYPES, Attempt, Exercise, Lesson, Streak
from ..models.user import ROLE_ADMIN, ROLE_LEARNER, ROLE_TEACHER, User
from ..utils.responses import fail, ok
from ..utils.security import current_user, roles_required

admin_bp = Blueprint("admin", __name__)
manager = roles_required(ROLE_ADMIN, ROLE_TEACHER)
admin_only = roles_required(ROLE_ADMIN)

VALID_ROLES = (ROLE_LEARNER, ROLE_TEACHER, ROLE_ADMIN)
_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _body() -> dict:
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def _get_or_fail(model, object_id, label):
    """Trả về (obj, None) hoặc (None, response lỗi 404 tiếng Việt)."""
    obj = model.query.get(object_id)
    if obj is None:
        return None, fail(f"Không tìm thấy {label}", 404)
    return obj, None


def _clean_str(body, field, *, required=False, max_len=None):
    """Lấy + validate một trường chuỗi. Trả về (value, error_response)."""
    raw = body.get(field)
    if raw is None:
        if required:
            return None, fail(f"Trường '{field}' là bắt buộc")
        return None, None
    if not isinstance(raw, str):
        return None, fail(f"Trường '{field}' phải là chuỗi ký tự")
    value = raw.strip()
    if required and not value:
        return None, fail(f"Trường '{field}' không được để trống")
    if max_len and len(value) > max_len:
        return None, fail(f"Trường '{field}' tối đa {max_len} ký tự")
    return value, None


def _clean_int(body, field, *, default=None, min_value=None):
    """Lấy + validate một trường số nguyên. Trả về (value, error_response)."""
    raw = body.get(field, default)
    if raw is None:
        return None, None
    if isinstance(raw, bool) or not isinstance(raw, int):
        return None, fail(f"Trường '{field}' phải là số nguyên")
    if min_value is not None and raw < min_value:
        return None, fail(f"Trường '{field}' phải lớn hơn hoặc bằng {min_value}")
    return raw, None


def _commit_or_conflict(message):
    """Commit, đổi lỗi ràng buộc DB (slug trùng, FK khi xóa...) thành 409."""
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return fail(message, 409)
    return None


def _pagination_args():
    page = request.args.get("page", 1, type=int) or 1
    per_page = request.args.get("per_page", 20, type=int) or 20
    return max(page, 1), min(max(per_page, 1), 100)


def _unit_dict(unit):
    return {"id": unit.id, "course_id": unit.course_id, "title": unit.title,
            "order_index": unit.order_index}


def _lesson_dict(lesson):
    return {"id": lesson.id, "unit_id": lesson.unit_id, "title": lesson.title,
            "description": lesson.description, "order_index": lesson.order_index,
            "xp_reward": lesson.xp_reward}


# ---------------------------------------------------------------------------
# Thống kê tổng quan
# ---------------------------------------------------------------------------

@admin_bp.get("/stats")
@manager
def stats():
    today = date.today()
    seven_days_ago = today - timedelta(days=7)

    total_attempts = Attempt.query.count()
    correct = Attempt.query.filter_by(is_correct=True).count()

    new_users_7d = (User.query
                    .filter(func.date(User.created_at) >= seven_days_ago)
                    .count())

    # Hoạt động hôm nay: user có lượt làm bài hôm nay (Attempt) hoặc có
    # streak được chạm hôm nay (Streak.last_study_date). Gộp 2 nguồn, khử trùng.
    attempt_user_ids = {
        row[0] for row in db.session.query(Attempt.user_id)
        .filter(func.date(Attempt.created_at) == today).distinct().all()
    }
    streak_user_ids = {
        row[0] for row in db.session.query(Streak.user_id)
        .filter(Streak.last_study_date == today).distinct().all()
    }

    return ok({
        "total_learners": User.query.filter_by(role=ROLE_LEARNER).count(),
        "total_teachers": User.query.filter_by(role=ROLE_TEACHER).count(),
        "total_users": User.query.count(),
        "total_courses": Course.query.count(),
        "total_lessons": Lesson.query.count(),
        "total_exercises": Exercise.query.count(),
        "total_attempts": total_attempts,
        "accuracy_percent": round(correct * 100 / total_attempts, 1) if total_attempts else 0,
        "new_users_last_7_days": new_users_7d,
        "active_users_today": len(attempt_user_ids | streak_user_ids),
    })


@admin_bp.get("/lessons/weakest")
@manager
def weakest_lessons():
    """Bài học có tỉ lệ làm đúng thấp nhất (chỉ tính bài đã có lượt làm).

    Join đúng chuỗi Lesson -> Exercise -> Attempt, accuracy tính theo từng
    lesson, sắp xếp tăng dần (yếu nhất trước), tối đa 10 bài.
    """
    accuracy = func.avg(case((Attempt.is_correct, 1.0), else_=0.0))
    correct_count = func.sum(case((Attempt.is_correct, 1), else_=0))
    rows = (
        db.session.query(
            Lesson.id.label("lesson_id"),
            Lesson.title.label("title"),
            Lesson.unit_id.label("unit_id"),
            Unit.course_id.label("course_id"),
            func.count(Attempt.id).label("attempts"),
            correct_count.label("correct"),
            accuracy.label("accuracy"),
        )
        .join(Exercise, Exercise.lesson_id == Lesson.id)
        .join(Attempt, Attempt.exercise_id == Exercise.id)
        .join(Unit, Unit.id == Lesson.unit_id)
        .group_by(Lesson.id, Lesson.title, Lesson.unit_id, Unit.course_id)
        .order_by(accuracy.asc(), func.count(Attempt.id).desc())
        .limit(10)
        .all()
    )
    return ok([
        {
            "lesson_id": r.lesson_id,
            "title": r.title,
            "unit_id": r.unit_id,
            "course_id": r.course_id,
            "attempts": r.attempts,
            "correct": int(r.correct or 0),
            "accuracy_percent": round(float(r.accuracy or 0) * 100, 1),
        }
        for r in rows
    ])


# ---------------------------------------------------------------------------
# Quản lý người dùng
# ---------------------------------------------------------------------------

@admin_bp.get("/users")
@manager
def list_users():
    page, per_page = _pagination_args()
    q = (request.args.get("q") or "").strip()
    role = (request.args.get("role") or "").strip().upper()
    if role and role not in VALID_ROLES:
        return fail("Role không hợp lệ, chỉ chấp nhận: LEARNER, TEACHER, ADMIN")
    query = User.query
    if q:
        query = query.filter(User.full_name.ilike(f"%{q}%") | User.email.ilike(f"%{q}%"))
    if role:
        query = query.filter_by(role=role)
    if request.args.get("is_active") in ("true", "false"):
        query = query.filter_by(is_active=request.args.get("is_active") == "true")
    pagination = query.order_by(User.id.desc()).paginate(
        page=page, per_page=per_page, error_out=False)
    return ok([u.to_dict() for u in pagination.items],
              total=pagination.total, page=page, per_page=per_page,
              pages=pagination.pages)


@admin_bp.patch("/users/<int:user_id>")
@admin_only
def update_user(user_id):
    """Khóa / mở tài khoản và đổi role. Chỉ ADMIN."""
    user, err = _get_or_fail(User, user_id, "người dùng")
    if err:
        return err
    body = _body()
    if "is_active" not in body and "role" not in body:
        return fail("Không có trường nào để cập nhật, gửi 'is_active' và/hoặc 'role'")

    actor = current_user()
    new_active = body.get("is_active", user.is_active)
    new_role = body.get("role", user.role)

    if "is_active" in body and not isinstance(new_active, bool):
        return fail("Trường 'is_active' phải là true hoặc false")
    if "role" in body:
        if not isinstance(new_role, str) or new_role.strip().upper() not in VALID_ROLES:
            return fail("Role không hợp lệ, chỉ chấp nhận: LEARNER, TEACHER, ADMIN")
        new_role = new_role.strip().upper()

    # Không tự khóa / tự hạ quyền chính mình qua API này.
    if actor and actor.id == user.id:
        if new_active is False:
            return fail("Không thể tự khóa tài khoản của chính mình", 400)
        if new_role != ROLE_ADMIN:
            return fail("Không thể tự đổi role của chính mình khỏi ADMIN", 400)

    # Luôn giữ ít nhất một ADMIN đang hoạt động.
    loses_admin = (user.role == ROLE_ADMIN and user.is_active
                   and (new_role != ROLE_ADMIN or new_active is False))
    if loses_admin:
        other_admins = (User.query.filter(User.role == ROLE_ADMIN,
                                          User.is_active.is_(True),
                                          User.id != user.id).count())
        if other_admins == 0:
            return fail("Không thể thực hiện: đây là ADMIN đang hoạt động cuối cùng", 400)

    user.is_active = new_active
    user.role = new_role
    db.session.commit()
    return ok(user.to_dict())


# ---------------------------------------------------------------------------
# CRUD khóa học
# ---------------------------------------------------------------------------

@admin_bp.get("/courses")
@manager
def list_courses_admin():
    courses = Course.query.order_by(Course.id).all()
    return ok([c.to_dict() for c in courses])


def _validate_course_fields(body, *, partial, current_id=None):
    """Trả về (values, error_response) cho create (partial=False) / update."""
    values = {}
    title, err = _clean_str(body, "title", required=not partial, max_len=200)
    if err:
        return None, err
    if title is not None:
        values["title"] = title
    slug, err = _clean_str(body, "slug", required=not partial, max_len=220)
    if err:
        return None, err
    if slug is not None:
        slug = slug.lower()
        if not _SLUG_RE.match(slug):
            return None, fail("Slug chỉ gồm chữ thường, số và dấu gạch ngang (ví dụ: tieng-anh-a1)")
        dup = Course.query.filter_by(slug=slug)
        if current_id is not None:
            dup = dup.filter(Course.id != current_id)
        if dup.first():
            return None, fail("Slug đã tồn tại, vui lòng chọn slug khác", 409)
        values["slug"] = slug
    description, err = _clean_str(body, "description")
    if err:
        return None, err
    if description is not None:
        values["description"] = description
    level, err = _clean_str(body, "level", max_len=20)
    if err:
        return None, err
    if level is not None:
        values["level"] = level.upper()
    if "is_published" in body:
        if not isinstance(body["is_published"], bool):
            return None, fail("Trường 'is_published' phải là true hoặc false")
        values["is_published"] = body["is_published"]
    if not partial and "title" not in values:
        return None, fail("Trường 'title' là bắt buộc")
    return values, None


@admin_bp.post("/courses")
@admin_only
def create_course():
    values, err = _validate_course_fields(_body(), partial=False)
    if err:
        return err
    actor = current_user()
    course = Course(created_by=actor.id if actor else None, **values)
    db.session.add(course)
    conflict = _commit_or_conflict("Không tạo được khóa học, dữ liệu bị trùng lặp")
    if conflict:
        return conflict
    return ok(course.to_dict(), 201)


@admin_bp.put("/courses/<int:course_id>")
@admin_only
def update_course(course_id):
    course, err = _get_or_fail(Course, course_id, "khóa học")
    if err:
        return err
    values, err = _validate_course_fields(_body(), partial=True, current_id=course.id)
    if err:
        return err
    if not values:
        return fail("Không có trường nào để cập nhật")
    for key, value in values.items():
        setattr(course, key, value)
    conflict = _commit_or_conflict("Không cập nhật được khóa học, dữ liệu bị trùng lặp")
    if conflict:
        return conflict
    return ok(course.to_dict())


@admin_bp.delete("/courses/<int:course_id>")
@admin_only
def delete_course(course_id):
    course, err = _get_or_fail(Course, course_id, "khóa học")
    if err:
        return err
    db.session.delete(course)
    conflict = _commit_or_conflict(
        "Không thể xóa khóa học vì đã có dữ liệu học tập liên quan")
    if conflict:
        return conflict
    return ok({"deleted": True, "id": course_id})


# ---------------------------------------------------------------------------
# CRUD chương (Unit)
# ---------------------------------------------------------------------------

@admin_bp.post("/courses/<int:course_id>/units")
@admin_only
def create_unit(course_id):
    course, err = _get_or_fail(Course, course_id, "khóa học")
    if err:
        return err
    body = _body()
    title, err = _clean_str(body, "title", required=True, max_len=200)
    if err:
        return err
    order_index, err = _clean_int(body, "order_index", default=0, min_value=0)
    if err:
        return err
    unit = Unit(course_id=course.id, title=title, order_index=order_index)
    db.session.add(unit)
    db.session.commit()
    return ok(_unit_dict(unit), 201)


@admin_bp.put("/units/<int:unit_id>")
@admin_only
def update_unit(unit_id):
    unit, err = _get_or_fail(Unit, unit_id, "chương học")
    if err:
        return err
    body = _body()
    title, err = _clean_str(body, "title", max_len=200)
    if err:
        return err
    order_index, err = _clean_int(body, "order_index", min_value=0)
    if err:
        return err
    if title is None and order_index is None:
        return fail("Không có trường nào để cập nhật")
    if title is not None:
        unit.title = title
    if order_index is not None:
        unit.order_index = order_index
    db.session.commit()
    return ok(_unit_dict(unit))


@admin_bp.delete("/units/<int:unit_id>")
@admin_only
def delete_unit(unit_id):
    unit, err = _get_or_fail(Unit, unit_id, "chương học")
    if err:
        return err
    db.session.delete(unit)
    conflict = _commit_or_conflict(
        "Không thể xóa chương học vì đã có dữ liệu học tập liên quan")
    if conflict:
        return conflict
    return ok({"deleted": True, "id": unit_id})


# ---------------------------------------------------------------------------
# CRUD bài học (Lesson)
# ---------------------------------------------------------------------------

@admin_bp.post("/units/<int:unit_id>/lessons")
@admin_only
def create_lesson(unit_id):
    unit, err = _get_or_fail(Unit, unit_id, "chương học")
    if err:
        return err
    body = _body()
    title, err = _clean_str(body, "title", required=True, max_len=200)
    if err:
        return err
    description, err = _clean_str(body, "description")
    if err:
        return err
    order_index, err = _clean_int(body, "order_index", default=0, min_value=0)
    if err:
        return err
    xp_reward, err = _clean_int(body, "xp_reward", default=10, min_value=0)
    if err:
        return err
    lesson = Lesson(unit_id=unit.id, title=title, description=description or "",
                    order_index=order_index, xp_reward=xp_reward)
    db.session.add(lesson)
    db.session.commit()
    return ok(_lesson_dict(lesson), 201)


@admin_bp.put("/lessons/<int:lesson_id>")
@admin_only
def update_lesson(lesson_id):
    lesson, err = _get_or_fail(Lesson, lesson_id, "bài học")
    if err:
        return err
    body = _body()
    title, err = _clean_str(body, "title", max_len=200)
    if err:
        return err
    description, err = _clean_str(body, "description")
    if err:
        return err
    order_index, err = _clean_int(body, "order_index", min_value=0)
    if err:
        return err
    xp_reward, err = _clean_int(body, "xp_reward", min_value=0)
    if err:
        return err
    updates = {"title": title, "description": description,
               "order_index": order_index, "xp_reward": xp_reward}
    if all(v is None for v in updates.values()):
        return fail("Không có trường nào để cập nhật")
    for key, value in updates.items():
        if value is not None:
            setattr(lesson, key, value)
    db.session.commit()
    return ok(_lesson_dict(lesson))


@admin_bp.delete("/lessons/<int:lesson_id>")
@admin_only
def delete_lesson(lesson_id):
    lesson, err = _get_or_fail(Lesson, lesson_id, "bài học")
    if err:
        return err
    db.session.delete(lesson)
    conflict = _commit_or_conflict(
        "Không thể xóa bài học vì đã có dữ liệu học tập liên quan")
    if conflict:
        return conflict
    return ok({"deleted": True, "id": lesson_id})


# ---------------------------------------------------------------------------
# CRUD bài tập (Exercise)
# ---------------------------------------------------------------------------

def _validate_exercise_fields(body, *, partial):
    """Trả về (values, error_response) cho create / update bài tập."""
    values = {}
    ex_type, err = _clean_str(body, "type", required=not partial, max_len=30)
    if err:
        return None, err
    if ex_type is not None:
        ex_type = ex_type.upper()
        if ex_type not in EXERCISE_TYPES:
            return None, fail(
                "Loại bài tập không hợp lệ, chỉ chấp nhận: " + ", ".join(EXERCISE_TYPES))
        values["type"] = ex_type
    question, err = _clean_str(body, "question", required=not partial)
    if err:
        return None, err
    if question is not None:
        values["question"] = question
    correct, err = _clean_str(body, "correct_answer", required=not partial)
    if err:
        return None, err
    if correct is not None:
        values["correct_answer"] = correct
    explanation, err = _clean_str(body, "explanation")
    if err:
        return None, err
    if explanation is not None:
        values["explanation"] = explanation
    if "options" in body:
        options = body["options"]
        if options is not None:
            if (not isinstance(options, list)
                    or any(not isinstance(o, str) or not o.strip() for o in options)):
                return None, fail("Trường 'options' phải là danh sách các chuỗi không rỗng")
            values["options"] = options
        else:
            values["options"] = None
    order_index, err = _clean_int(body, "order_index", default=0 if not partial else None,
                                  min_value=0)
    if err:
        return None, err
    if order_index is not None:
        values["order_index"] = order_index
    # Trắc nghiệm bắt buộc có >= 2 lựa chọn và đáp án phải nằm trong lựa chọn.
    effective_type = values.get("type")
    effective_options = values.get("options")
    effective_answer = values.get("correct_answer")
    if not partial:
        if effective_type == "MULTIPLE_CHOICE":
            if not effective_options or len(effective_options) < 2:
                return None, fail("Bài trắc nghiệm cần ít nhất 2 lựa chọn trong 'options'")
            if effective_answer not in effective_options:
                return None, fail("Đáp án đúng phải nằm trong danh sách 'options'")
    else:
        if effective_options is not None and len(effective_options) == 1:
            return None, fail("Trường 'options' cần ít nhất 2 lựa chọn")
        if (effective_options is not None and effective_answer is not None
                and effective_answer not in effective_options):
            return None, fail("Đáp án đúng phải nằm trong danh sách 'options'")
    return values, None


@admin_bp.post("/lessons/<int:lesson_id>/exercises")
@admin_only
def create_exercise(lesson_id):
    lesson, err = _get_or_fail(Lesson, lesson_id, "bài học")
    if err:
        return err
    values, err = _validate_exercise_fields(_body(), partial=False)
    if err:
        return err
    exercise = Exercise(lesson_id=lesson.id, **values)
    db.session.add(exercise)
    db.session.commit()
    return ok(exercise.to_dict(include_answer=True), 201)


@admin_bp.put("/exercises/<int:exercise_id>")
@admin_only
def update_exercise(exercise_id):
    exercise, err = _get_or_fail(Exercise, exercise_id, "bài tập")
    if err:
        return err
    values, err = _validate_exercise_fields(_body(), partial=True)
    if err:
        return err
    if not values:
        return fail("Không có trường nào để cập nhật")
    for key, value in values.items():
        setattr(exercise, key, value)
    db.session.commit()
    return ok(exercise.to_dict(include_answer=True))


@admin_bp.delete("/exercises/<int:exercise_id>")
@admin_only
def delete_exercise(exercise_id):
    exercise, err = _get_or_fail(Exercise, exercise_id, "bài tập")
    if err:
        return err
    db.session.delete(exercise)
    conflict = _commit_or_conflict(
        "Không thể xóa bài tập vì đã có lượt làm bài liên quan")
    if conflict:
        return conflict
    return ok({"deleted": True, "id": exercise_id})

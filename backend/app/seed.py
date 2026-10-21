"""Seed dữ liệu mẫu cho demo/bảo vệ.

Dữ liệu khóa học nằm ở ``backend/seed_data/courses.json`` (ngoài package ``app``,
bên cạnh thư mục ``app/``). Lệnh ``flask seed``:

- Tạo admin từ env ``ADMIN_EMAIL`` / ``ADMIN_PASSWORD``
  (mặc định admin@example.com / Admin@12345 — chỉ dùng cho local/demo).
- Tạo learner demo learner@example.com / Learner@123
  (đổi được qua ``LEARNER_EMAIL`` / ``LEARNER_PASSWORD``).
- Nạp 2 khóa: "Tiếng Anh giao tiếp A1" (slug english-a1) và
  "Tiếng Anh A2" (slug english-a2) với unit/lesson/exercise trong JSON.

Idempotent: mọi bản ghi đều get-or-create theo khóa tự nhiên —
course theo ``slug``, unit theo (course_id, title), lesson theo
(unit_id, title), exercise theo (lesson_id, order_index), user theo ``email``
— nên chạy ``flask seed`` nhiều lần không tạo trùng, cũng không ghi đè
mật khẩu admin/learner đã đổi sau này.
"""
import json
import os
from pathlib import Path

import click
from flask.cli import with_appcontext

from .extensions import db
from .models.course import Course, Unit
from .models.learning import Exercise, Lesson
from .models.user import ROLE_ADMIN, ROLE_LEARNER, User

SEED_DATA_FILE = Path(__file__).resolve().parent.parent / "seed_data" / "courses.json"


def _get_or_create_user(email, full_name, role, password):
    user = User.query.filter_by(email=email).first()
    if user:
        return user, False
    user = User(email=email, full_name=full_name, role=role)
    user.set_password(password)
    db.session.add(user)
    db.session.flush()
    return user, True


def _seed_courses(stats):
    data = json.loads(SEED_DATA_FILE.read_text(encoding="utf-8"))
    for course_data in data["courses"]:
        course = Course.query.filter_by(slug=course_data["slug"]).first()
        if not course:
            course = Course(
                title=course_data["title"],
                slug=course_data["slug"],
                description=course_data.get("description", ""),
                level=course_data.get("level", "A1"),
                is_published=course_data.get("is_published", False),
            )
            db.session.add(course)
            db.session.flush()
            stats["courses"] += 1
        for unit_data in course_data["units"]:
            unit = Unit.query.filter_by(course_id=course.id, title=unit_data["title"]).first()
            if not unit:
                unit = Unit(course_id=course.id, title=unit_data["title"],
                            order_index=unit_data["order_index"])
                db.session.add(unit)
                db.session.flush()
                stats["units"] += 1
            for lesson_data in unit_data["lessons"]:
                lesson = Lesson.query.filter_by(unit_id=unit.id,
                                                title=lesson_data["title"]).first()
                if not lesson:
                    lesson = Lesson(unit_id=unit.id, title=lesson_data["title"],
                                    description=lesson_data.get("description", ""),
                                    order_index=lesson_data["order_index"],
                                    xp_reward=lesson_data.get("xp_reward", 10))
                    db.session.add(lesson)
                    db.session.flush()
                    stats["lessons"] += 1
                for ex_data in lesson_data["exercises"]:
                    exists = Exercise.query.filter_by(
                        lesson_id=lesson.id, order_index=ex_data["order_index"]).first()
                    if exists:
                        continue
                    db.session.add(Exercise(
                        lesson_id=lesson.id,
                        type=ex_data["type"],
                        question=ex_data["question"],
                        options=ex_data.get("options"),
                        correct_answer=ex_data["correct_answer"],
                        explanation=ex_data.get("explanation", ""),
                        order_index=ex_data["order_index"],
                    ))
                    stats["exercises"] += 1


def register_seed_cli(app):
    @app.cli.command("seed")
    @with_appcontext
    def seed():
        """Create demo accounts (admin from env + learner) and sample courses. Idempotent."""
        db.create_all()
        stats = {"courses": 0, "units": 0, "lessons": 0, "exercises": 0}

        admin_email = os.getenv("ADMIN_EMAIL", "admin@example.com")
        _, admin_created = _get_or_create_user(
            admin_email, "Quản trị viên", ROLE_ADMIN,
            os.getenv("ADMIN_PASSWORD", "Admin@12345"))

        learner_email = os.getenv("LEARNER_EMAIL", "learner@example.com")
        _, learner_created = _get_or_create_user(
            learner_email, "Học viên Demo", ROLE_LEARNER,
            os.getenv("LEARNER_PASSWORD", "Learner@123"))

        _seed_courses(stats)
        db.session.commit()
        click.echo(
            "Seed xong (idempotent): "
            f"admin {admin_email} ({'mới tạo' if admin_created else 'đã có'}), "
            f"learner {learner_email} ({'mới tạo' if learner_created else 'đã có'}), "
            f"mới thêm {stats['courses']} course, {stats['units']} unit, "
            f"{stats['lessons']} lesson, {stats['exercises']} exercise."
        )

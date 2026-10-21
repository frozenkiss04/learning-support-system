"""Learner progress + spaced-repetition endpoints.

Registered by the app factory under ``/api/progress``:

- ``GET  /due``                    review cards that are due now
- ``POST /review/<exercise_id>``   grade one review answer, reschedule its card
- ``GET  /summary``                XP, streak, completed lessons, due count
- ``GET  /activity``               per-day study activity (heatmap data)
"""
from datetime import datetime, timedelta, timezone

from flask import Blueprint, request
from flask_jwt_extended import jwt_required
from sqlalchemy import func

from ..extensions import db
from ..models.learning import Attempt, Exercise, Streak, UserProgress
from ..services.srs_service import due_cards, due_count, record_result
from ..utils.responses import fail, ok
from ..utils.security import current_user

progress_bp = Blueprint("progress", __name__)

MAX_DUE_LIMIT = 100

DEFAULT_ACTIVITY_DAYS = 84
MIN_ACTIVITY_DAYS = 7
MAX_ACTIVITY_DAYS = 182


@progress_bp.get("/due")
@jwt_required()
def due_reviews():
    user = current_user()
    limit = request.args.get("limit", 20, type=int)
    limit = max(1, min(limit or 20, MAX_DUE_LIMIT))
    cards = due_cards(user.id, limit=limit)
    return ok([card.to_dict(include_exercise=True) for card in cards])


@progress_bp.post("/review/<int:exercise_id>")
@jwt_required()
def submit_review(exercise_id):
    user = current_user()
    body = request.get_json(silent=True) or {}
    is_correct = body.get("is_correct")
    if not isinstance(is_correct, bool):
        return fail("Trường is_correct (true/false) là bắt buộc")
    quality = body.get("quality")
    if quality is not None and (not isinstance(quality, int) or not 0 <= quality <= 5):
        return fail("quality phải là số nguyên từ 0 đến 5")

    Exercise.query.get_or_404(exercise_id)
    card = record_result(user.id, exercise_id, is_correct, quality=quality)
    db.session.commit()
    return ok(card.to_dict())


@progress_bp.get("/summary")
@jwt_required()
def summary():
    user = current_user()
    streak = Streak.query.get(user.id)
    completed = UserProgress.query.filter_by(
        user_id=user.id, status="COMPLETED"
    ).count()
    return ok({
        "xp": user.xp,
        "current_streak": streak.current_streak if streak else 0,
        "longest_streak": streak.longest_streak if streak else 0,
        "completed_lessons": completed,
        "due_reviews": due_count(user.id),
    })


@progress_bp.get("/activity")
@jwt_required()
def activity():
    user = current_user()
    days = request.args.get("days", DEFAULT_ACTIVITY_DAYS, type=int)
    days = max(MIN_ACTIVITY_DAYS, min(days or DEFAULT_ACTIVITY_DAYS, MAX_ACTIVITY_DAYS))

    # Attempts are timestamped in UTC (see Attempt.created_at), so the window
    # is anchored on the current UTC date and days are bucketed by UTC date.
    # The count is grouped in SQL — no per-row loading into Python.
    since = datetime.now(timezone.utc).date() - timedelta(days=days - 1)
    day_col = func.date(Attempt.created_at)
    rows = (
        db.session.query(day_col.label("day"), func.count(Attempt.id).label("count"))
        .filter(Attempt.user_id == user.id, day_col >= since)
        .group_by(day_col)
        .order_by(day_col.asc())
        .all()
    )
    entries = [
        {
            # SQLite yields a "YYYY-MM-DD" string, Postgres a date object.
            "date": row.day.isoformat() if hasattr(row.day, "isoformat") else str(row.day),
            "count": int(row.count),
        }
        for row in rows
    ]
    return ok({
        "days": entries,
        "total_active_days": len(entries),
        "total_actions": sum(entry["count"] for entry in entries),
    })

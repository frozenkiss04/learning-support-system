"""Learner progress + spaced-repetition endpoints.

Registered by the app factory under ``/api/progress``:

- ``GET  /due``                    review cards that are due now
- ``POST /review/<exercise_id>``   grade one review answer, reschedule its card
- ``GET  /summary``                XP, streak, completed lessons, due count
- ``GET  /activity``               per-day study activity (heatmap data)
- ``GET  /quests``                 today's daily quests + claim state
- ``POST /quests/claim``           claim the all-quests-done XP bonus (once/day)
- ``GET  /weekly-league``          this week's XP league (from Monday, UTC)
"""
from datetime import datetime, timedelta, timezone

from flask import Blueprint, request
from flask_jwt_extended import jwt_required
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from ..extensions import db
from ..models.gamification import UserQuestClaim
from ..models.learning import Attempt, Exercise, Lesson, Streak, UserProgress
from ..models.review import ReviewCard
from ..models.user import User
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


# ---------------------------------------------------------------------------
# Daily quests + weekly league (gamification).
#
# Quest progress is derived from the day's real activity — nothing extra is
# recorded while learning. Only the reward claim is persisted
# (UserQuestClaim, one row per user per UTC day). All day boundaries are
# UTC, matching how Attempt/UserProgress timestamps are written.
# ---------------------------------------------------------------------------

QUEST_CLAIM_XP = 30

QUEST_DEFS = (
    ("lesson", "Hoàn thành 1 bài học", 1),
    ("review", "Ôn tập 5 thẻ ghi nhớ", 5),
    ("practice", "Làm 10 câu bài tập", 10),
)


def _daily_quests(user_id, today):
    """Quest list for one UTC day with capped progress + done flags."""
    completed_today = (
        UserProgress.query
        .filter(UserProgress.user_id == user_id,
                UserProgress.status == "COMPLETED",
                func.date(UserProgress.completed_at) == today)
        .count()
    )
    # ReviewCard has no dedicated "reviewed at" column; updated_at is bumped
    # by the SRS service on every review (and set when the card is created),
    # so it is the timestamp of the last time the card was worked on.
    reviewed_today = (
        ReviewCard.query
        .filter(ReviewCard.user_id == user_id,
                func.date(ReviewCard.updated_at) == today)
        .count()
    )
    attempts_today = (
        Attempt.query
        .filter(Attempt.user_id == user_id,
                func.date(Attempt.created_at) == today)
        .count()
    )
    raw = {"lesson": completed_today, "review": reviewed_today, "practice": attempts_today}
    return [
        {
            "key": key,
            "title": title,
            "target": target,
            "progress": min(raw[key], target),
            "done": raw[key] >= target,
        }
        for key, title, target in QUEST_DEFS
    ]


@progress_bp.get("/quests")
@jwt_required()
def daily_quests():
    user = current_user()
    today = datetime.now(timezone.utc).date()
    quests = _daily_quests(user.id, today)
    claimed = (
        UserQuestClaim.query
        .filter_by(user_id=user.id, quest_date=today)
        .first()
    ) is not None
    return ok({
        "date": today.isoformat(),
        "quests": quests,
        "all_done": all(q["done"] for q in quests),
        "claimed": claimed,
        "claim_xp": QUEST_CLAIM_XP,
    })


@progress_bp.post("/quests/claim")
@jwt_required()
def claim_daily_quests():
    user = current_user()
    today = datetime.now(timezone.utc).date()
    already = (
        UserQuestClaim.query
        .filter_by(user_id=user.id, quest_date=today)
        .first()
    )
    if already is not None:
        return fail("Đã nhận thưởng nhiệm vụ hôm nay", 409)
    quests = _daily_quests(user.id, today)
    if not all(q["done"] for q in quests):
        return fail("Chưa hoàn thành đủ nhiệm vụ", 400)

    db.session.add(UserQuestClaim(
        user_id=user.id, quest_date=today, xp_awarded=QUEST_CLAIM_XP,
    ))
    user.xp = (user.xp or 0) + QUEST_CLAIM_XP
    try:
        db.session.commit()
    except IntegrityError:
        # Lost a race against a parallel claim — the unique
        # (user_id, quest_date) constraint kept the bonus single.
        db.session.rollback()
        return fail("Đã nhận thưởng nhiệm vụ hôm nay", 409)
    return ok({"xp_awarded": QUEST_CLAIM_XP, "xp": user.xp})


@progress_bp.get("/weekly-league")
@jwt_required()
def weekly_league():
    user = current_user()
    today = datetime.now(timezone.utc).date()
    week_start = today - timedelta(days=today.weekday())  # Monday of this week
    week_end = week_start + timedelta(days=6)  # Sunday

    rows = (
        db.session.query(
            UserProgress.user_id.label("user_id"),
            func.coalesce(func.sum(Lesson.xp_reward), 0).label("weekly_xp"),
        )
        .join(Lesson, Lesson.id == UserProgress.lesson_id)
        .filter(
            UserProgress.status == "COMPLETED",
            func.date(UserProgress.completed_at) >= week_start,
            func.date(UserProgress.completed_at) <= today,
        )
        .group_by(UserProgress.user_id)
        .all()
    )
    xp_by_user = {row.user_id: int(row.weekly_xp) for row in rows if row.weekly_xp}

    # Ranking pool: everyone who earned XP this week, plus the current user
    # even at 0 XP so their rank is always a real position. Ordering matches
    # the global leaderboard: XP desc, then user id asc as the tiebreak.
    pool = set(xp_by_user) | {user.id}
    ranked = sorted(pool, key=lambda uid: (-xp_by_user.get(uid, 0), uid))
    my_weekly_xp = xp_by_user.get(user.id, 0)
    my_rank = ranked.index(user.id) + 1

    top_ids = ranked[:20]
    names = {
        u.id: u.full_name
        for u in User.query.filter(User.id.in_(top_ids)).all()
    } if top_ids else {}
    entries = [
        {
            "user_id": uid,
            "full_name": names.get(uid, ""),
            "weekly_xp": xp_by_user.get(uid, 0),
            "rank": idx + 1,
            "is_me": uid == user.id,
        }
        for idx, uid in enumerate(top_ids)
    ]

    if my_weekly_xp <= 0:
        tier = None
    elif my_rank <= 3:
        tier = "Vàng"
    elif my_rank <= 10:
        tier = "Bạc"
    else:
        tier = "Đồng"

    return ok({
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
        "entries": entries,
        "my_rank": my_rank,
        "my_weekly_xp": my_weekly_xp,
        "tier": tier,
    })

"""Spaced repetition scheduling — simplified SM-2.

Rules (binary grading: the app only knows correct / wrong per answer):

- Answer quality is derived from the result unless the caller passes an
  explicit SM-2 quality (0-5): correct -> 5, wrong -> 2.
- Lapse (quality < 3): the card becomes due again immediately
  (``next_review_at = now``, so it resurfaces in the same study
  session's review queue), ``repetitions`` resets to 0 and
  ``interval_days`` to 0.
- Success (quality >= 3): ``repetitions`` grows and the interval follows
  SM-2 — 1 day after the 1st success, 6 days after the 2nd, then
  ``round(previous_interval * ease_factor)``.
- ``ease_factor`` is adjusted with the standard SM-2 formula
  ``EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))`` and never drops
  below ``MIN_EASE_FACTOR`` (1.3).

None of these helpers commit: the caller owns the transaction, so
``grade_lesson`` can update cards and progress in a single commit.
"""
from datetime import datetime, timedelta, timezone

from ..extensions import db
from ..models.review import DEFAULT_EASE_FACTOR, ReviewCard

MIN_EASE_FACTOR = 1.3
FIRST_INTERVAL_DAYS = 1
SECOND_INTERVAL_DAYS = 6


def _now(now: datetime | None = None) -> datetime:
    """Current time as naive UTC.

    The review_cards columns are plain DateTime (no tz), like the rest of
    the schema; normalising to naive UTC keeps stored values and query
    comparisons consistent on both SQLite and Postgres.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    if now.tzinfo is not None:
        now = now.astimezone(timezone.utc).replace(tzinfo=None)
    return now


def get_or_create_card(user_id: int, exercise_id: int) -> ReviewCard:
    """Fetch the (user, exercise) card, creating a fresh due-now one if absent."""
    card = ReviewCard.query.filter_by(user_id=user_id, exercise_id=exercise_id).first()
    if card is None:
        # Set the SM-2 fields explicitly: column defaults only materialise
        # after a flush, but callers read/mutate them right away.
        card = ReviewCard(
            user_id=user_id,
            exercise_id=exercise_id,
            ease_factor=DEFAULT_EASE_FACTOR,
            interval_days=0,
            repetitions=0,
            next_review_at=_now(),
        )
        db.session.add(card)
    return card


def apply_result(
    card: ReviewCard,
    is_correct: bool,
    quality: int | None = None,
    now: datetime | None = None,
) -> ReviewCard:
    """Apply one answer to a card's SM-2 schedule (no commit)."""
    now = _now(now)
    if quality is None:
        quality = 5 if is_correct else 2
    quality = max(0, min(5, int(quality)))

    # Tolerate cards whose defaults have not been flushed yet.
    if card.repetitions is None:
        card.repetitions = 0
    if card.interval_days is None:
        card.interval_days = 0
    if card.ease_factor is None:
        card.ease_factor = DEFAULT_EASE_FACTOR

    card.last_result = bool(is_correct)

    if quality < 3:
        # Lapse: forget the streak of successes, due again right away.
        card.repetitions = 0
        card.interval_days = 0
        card.next_review_at = now
    else:
        card.repetitions += 1
        if card.repetitions == 1:
            card.interval_days = FIRST_INTERVAL_DAYS
        elif card.repetitions == 2:
            card.interval_days = SECOND_INTERVAL_DAYS
        else:
            previous = card.interval_days or FIRST_INTERVAL_DAYS
            card.interval_days = max(1, round(previous * card.ease_factor))
        card.next_review_at = now + timedelta(days=card.interval_days)

    # SM-2 ease adjustment applies to every graded repetition.
    card.ease_factor = max(
        MIN_EASE_FACTOR,
        card.ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
    )
    card.updated_at = now
    return card


def record_result(
    user_id: int,
    exercise_id: int,
    is_correct: bool,
    quality: int | None = None,
    now: datetime | None = None,
) -> ReviewCard:
    """Create/update the card for an answered exercise (no commit)."""
    card = get_or_create_card(user_id, exercise_id)
    return apply_result(card, is_correct, quality=quality, now=now)


def due_cards(user_id: int, now: datetime | None = None, limit: int = 20) -> list[ReviewCard]:
    """Cards whose review time has arrived, most overdue first."""
    return (
        ReviewCard.query.filter(
            ReviewCard.user_id == user_id,
            ReviewCard.next_review_at <= _now(now),
        )
        .order_by(ReviewCard.next_review_at.asc())
        .limit(limit)
        .all()
    )


def due_count(user_id: int, now: datetime | None = None) -> int:
    return ReviewCard.query.filter(
        ReviewCard.user_id == user_id,
        ReviewCard.next_review_at <= _now(now),
    ).count()

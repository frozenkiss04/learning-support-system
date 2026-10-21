"""Spaced-repetition review cards (one card per user + exercise).

A card is created the first time a learner answers an exercise in a graded
lesson (or reviews it via the progress blueprint) and then carries the SM-2
schedule for that exercise: how well the learner remembers it, when it is due
again, and what happened last time.
"""
from datetime import datetime, timezone

from ..extensions import db

DEFAULT_EASE_FACTOR = 2.5


def _utcnow() -> datetime:
    """Naive UTC — the SRS service writes/compares review times the same way."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ReviewCard(db.Model):
    __tablename__ = "review_cards"
    __table_args__ = (
        db.UniqueConstraint("user_id", "exercise_id", name="uq_review_card_user_exercise"),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    exercise_id = db.Column(db.Integer, db.ForeignKey("exercises.id"), nullable=False, index=True)

    # SM-2 state.
    ease_factor = db.Column(db.Float, nullable=False, default=DEFAULT_EASE_FACTOR)
    interval_days = db.Column(db.Integer, nullable=False, default=0)
    repetitions = db.Column(db.Integer, nullable=False, default=0)

    next_review_at = db.Column(
        db.DateTime, nullable=False, index=True,
        default=_utcnow,
    )
    # True = last answer correct, False = wrong, None = never answered.
    last_result = db.Column(db.Boolean, nullable=True)

    created_at = db.Column(db.DateTime, default=_utcnow)
    updated_at = db.Column(
        db.DateTime,
        default=_utcnow,
        onupdate=_utcnow,
    )

    user = db.relationship("User", backref=db.backref("review_cards", lazy="dynamic"))
    exercise = db.relationship("Exercise", backref=db.backref("review_cards", lazy="dynamic"))

    def to_dict(self, include_exercise: bool = False):
        data = {
            "id": self.id,
            "user_id": self.user_id,
            "exercise_id": self.exercise_id,
            "ease_factor": round(self.ease_factor, 2) if self.ease_factor is not None else None,
            "interval_days": self.interval_days,
            "repetitions": self.repetitions,
            "next_review_at": self.next_review_at.isoformat() if self.next_review_at else None,
            "last_result": self.last_result,
        }
        if include_exercise and self.exercise is not None:
            # Never leak correct_answer to learners (same rule as lesson detail).
            data["exercise"] = self.exercise.to_dict()
        return data

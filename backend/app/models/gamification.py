"""Gamification state: daily-quest reward claims.

The daily quests themselves are derived from existing activity (lesson
completions, review cards touched, attempts — see the progress blueprint);
the only thing that needs persisting is that a learner already collected
the all-quests-done bonus for a given day, so it cannot be claimed twice.
One row per user per UTC day, enforced by a unique constraint.
"""
from datetime import datetime, timezone

from ..extensions import db


class UserQuestClaim(db.Model):
    __tablename__ = "user_quest_claims"
    __table_args__ = (
        db.UniqueConstraint("user_id", "quest_date", name="uq_user_quest_claim_day"),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    # UTC calendar day the quests were completed/claimed for.
    quest_date = db.Column(db.Date, nullable=False)
    xp_awarded = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    user = db.relationship("User", backref=db.backref("quest_claims", lazy="dynamic"))

"""Bộ bài luyện tập cá nhân hóa do AI sinh (một bộ cho mỗi user mỗi ngày).

Nội dung bộ bài nằm nguyên trong cột ``payload`` (JSON) — gồm cả đáp án đúng
để chấm khi nộp bài; các endpoint đọc công khai luôn phải lọc bỏ
``correct_answer`` trước khi trả cho client (xem ``public_exercises``).
"""
import json
from datetime import datetime, timezone

from ..extensions import db


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AiPracticeSet(db.Model):
    __tablename__ = "ai_practice_sets"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    set_date = db.Column(db.Date, nullable=False, index=True)
    # JSON: {"generated_by": "ai"|"bank", "exercises":
    #        [{id, type, question, options?, correct_answer, explanation}]}
    payload = db.Column(db.Text, nullable=False, default="{}")
    graded = db.Column(db.Boolean, nullable=False, default=False)
    xp_awarded = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, default=_utcnow)

    user = db.relationship("User", backref=db.backref("ai_practice_sets", lazy="dynamic"))

    # -- payload helpers -----------------------------------------------------
    def payload_data(self) -> dict:
        try:
            data = json.loads(self.payload or "{}")
        except (TypeError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    @property
    def generated_by(self) -> str:
        return self.payload_data().get("generated_by") or "bank"

    def exercises(self) -> list[dict]:
        """Toàn bộ câu hỏi KÈM đáp án — chỉ dùng nội bộ khi chấm bài."""
        items = self.payload_data().get("exercises")
        return items if isinstance(items, list) else []

    def public_exercises(self) -> list[dict]:
        """Câu hỏi an toàn để trả client: TUYỆT ĐỐI không có đáp án đúng."""
        public = []
        for ex in self.exercises():
            item = {"id": ex.get("id"), "type": ex.get("type"),
                    "question": ex.get("question")}
            if ex.get("options"):
                item["options"] = ex["options"]
            public.append(item)
        return public

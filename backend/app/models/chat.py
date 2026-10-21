from datetime import datetime, timezone

from ..extensions import db


class ChatSession(db.Model):
    __tablename__ = "chat_sessions"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    context_type = db.Column(db.String(20), nullable=False, default="LESSON")  # LESSON | ADMIN
    context_id = db.Column(db.Integer, nullable=True)  # lesson id when context_type=LESSON
    title = db.Column(db.String(200), default="")
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    messages = db.relationship("ChatMessage", back_populates="session",
                               cascade="all, delete-orphan", order_by="ChatMessage.id")


class ChatMessage(db.Model):
    __tablename__ = "chat_messages"

    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("chat_sessions.id"), nullable=False)
    role = db.Column(db.String(20), nullable=False)  # user | assistant | system
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    session = db.relationship("ChatSession", back_populates="messages")

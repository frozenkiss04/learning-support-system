from datetime import date, datetime, timezone

from ..extensions import db

EXERCISE_TYPES = ("MULTIPLE_CHOICE", "FILL_BLANK", "MATCHING", "TRANSLATE")

# Progress states stored on UserProgress.
PROGRESS_IN_PROGRESS = "IN_PROGRESS"
PROGRESS_COMPLETED = "COMPLETED"

# Lesson states exposed on the learning path (derived, never stored).
LESSON_COMPLETED = "COMPLETED"
LESSON_AVAILABLE = "AVAILABLE"
LESSON_LOCKED = "LOCKED"


class Lesson(db.Model):
    __tablename__ = "lessons"

    id = db.Column(db.Integer, primary_key=True)
    unit_id = db.Column(db.Integer, db.ForeignKey("units.id"), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, default="")
    order_index = db.Column(db.Integer, nullable=False, default=0)
    xp_reward = db.Column(db.Integer, nullable=False, default=10)

    unit = db.relationship("Unit", back_populates="lessons")
    exercises = db.relationship("Exercise", back_populates="lesson",
                                cascade="all, delete-orphan", order_by="Exercise.order_index")

    def to_dict(self, include_exercises: bool = False):
        data = {"id": self.id, "unit_id": self.unit_id, "title": self.title,
                "description": self.description, "order_index": self.order_index,
                "xp_reward": self.xp_reward,
                "total_exercises": len(self.exercises)}
        if include_exercises:
            # Exercise.to_dict() defaults to include_answer=False, so
            # correct_answer / explanation never leak to learners here.
            data["exercises"] = [e.to_dict() for e in self.exercises]
        return data


class Exercise(db.Model):
    __tablename__ = "exercises"

    id = db.Column(db.Integer, primary_key=True)
    lesson_id = db.Column(db.Integer, db.ForeignKey("lessons.id"), nullable=False)
    type = db.Column(db.String(30), nullable=False, default="MULTIPLE_CHOICE")
    question = db.Column(db.Text, nullable=False)
    options = db.Column(db.JSON, nullable=True)  # list[str] for multiple choice
    correct_answer = db.Column(db.Text, nullable=False)
    explanation = db.Column(db.Text, default="")
    order_index = db.Column(db.Integer, nullable=False, default=0)

    lesson = db.relationship("Lesson", back_populates="exercises")

    def to_dict(self, include_answer: bool = False):
        data = {"id": self.id, "lesson_id": self.lesson_id, "type": self.type,
                "question": self.question, "options": self.options,
                "order_index": self.order_index}
        if include_answer:
            data["correct_answer"] = self.correct_answer
            data["explanation"] = self.explanation
        return data


class UserProgress(db.Model):
    __tablename__ = "user_progress"
    __table_args__ = (db.UniqueConstraint("user_id", "lesson_id"),)

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    lesson_id = db.Column(db.Integer, db.ForeignKey("lessons.id"), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="IN_PROGRESS")  # IN_PROGRESS | COMPLETED
    score = db.Column(db.Integer, nullable=False, default=0)  # percent 0-100
    completed_at = db.Column(db.DateTime, nullable=True)

    def to_dict(self):
        return {"id": self.id, "user_id": self.user_id, "lesson_id": self.lesson_id,
                "status": self.status, "score": self.score,
                "completed_at": self.completed_at.isoformat() if self.completed_at else None}


class Attempt(db.Model):
    __tablename__ = "attempts"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    exercise_id = db.Column(db.Integer, db.ForeignKey("exercises.id"), nullable=False)
    answer = db.Column(db.Text, default="")
    is_correct = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class Streak(db.Model):
    __tablename__ = "streaks"

    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), primary_key=True)
    current_streak = db.Column(db.Integer, nullable=False, default=0)
    longest_streak = db.Column(db.Integer, nullable=False, default=0)
    last_study_date = db.Column(db.Date, nullable=True)

    user = db.relationship("User", back_populates="streak")

    def touch(self, today: date | None = None):
        today = today or date.today()
        if self.last_study_date == today:
            return
        if self.last_study_date and (today - self.last_study_date).days == 1:
            self.current_streak += 1
        else:
            self.current_streak = 1
        self.longest_streak = max(self.longest_streak, self.current_streak)
        self.last_study_date = today

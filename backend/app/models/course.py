from ..extensions import db


class Course(db.Model):
    __tablename__ = "courses"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    slug = db.Column(db.String(220), unique=True, nullable=False, index=True)
    description = db.Column(db.Text, default="")
    level = db.Column(db.String(20), default="A1")
    is_published = db.Column(db.Boolean, nullable=False, default=False)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)

    units = db.relationship("Unit", back_populates="course", cascade="all, delete-orphan",
                            order_by="Unit.order_index")

    def to_dict(self, total_units=None, total_lessons=None):
        """Serialize a course.

        ``total_units`` / ``total_lessons`` may be passed in pre-aggregated
        (see the courses list endpoint) to avoid lazy-loading every unit and
        lesson just to count them. When omitted, counts are derived from the
        loaded relationships and included as well.
        """
        if total_units is None or total_lessons is None:
            units = list(self.units)
            if total_units is None:
                total_units = len(units)
            if total_lessons is None:
                total_lessons = sum(len(unit.lessons) for unit in units)
        return {"id": self.id, "title": self.title, "slug": self.slug,
                "description": self.description, "level": self.level,
                "is_published": self.is_published,
                "total_units": total_units, "total_lessons": total_lessons}


class Unit(db.Model):
    __tablename__ = "units"

    id = db.Column(db.Integer, primary_key=True)
    course_id = db.Column(db.Integer, db.ForeignKey("courses.id"), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    order_index = db.Column(db.Integer, nullable=False, default=0)

    course = db.relationship("Course", back_populates="units")
    lessons = db.relationship("Lesson", back_populates="unit", cascade="all, delete-orphan",
                              order_by="Lesson.order_index")

    def to_dict(self):
        return {"id": self.id, "course_id": self.course_id, "title": self.title,
                "order_index": self.order_index,
                "total_lessons": len(self.lessons)}

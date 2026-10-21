from flask import Blueprint

from ..extensions import db
from ..utils.responses import ok

health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health():
    db_status = "up"
    try:
        db.session.execute(db.text("SELECT 1"))
    except Exception:
        db_status = "down"
    return ok({"service": "learning-support-api", "database": db_status})

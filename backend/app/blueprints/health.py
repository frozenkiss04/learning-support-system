from flask import Blueprint

from ..extensions import db
from ..utils.responses import fail, ok

health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health():
    db_status = "up"
    try:
        db.session.execute(db.text("SELECT 1"))
    except Exception:
        db.session.rollback()
        db_status = "down"
    if db_status == "down":
        # Render/health probe dựa vào status code: DB chết mà vẫn 200 thì
        # deploy lỗi vẫn nhận traffic. Trả 503, giữ nguyên shape data.
        return fail("Database không khả dụng", 503,
                    code="DATABASE_DOWN")
    return ok({"service": "learning-support-api", "database": db_status})

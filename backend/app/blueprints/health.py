from flask import Blueprint

import os

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
    data = {"service": "learning-support-api", "database": db_status}
    # Render tự đặt RENDER_GIT_COMMIT = SHA của commit đang chạy — để xác
    # định chính xác bản nào đang live sau mỗi lần deploy.
    commit = os.getenv("RENDER_GIT_COMMIT", "").strip()
    if commit:
        data["commit"] = commit[:7]
    return ok(data)

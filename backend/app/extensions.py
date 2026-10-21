"""Flask extension singletons — khởi tạo ở đây, init_app() trong app factory."""
import os

from flask import jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()
cors = CORS()  # origins lấy từ Config.CORS_ORIGINS khi init_app trong factory

# Rate limit: mặc định memory:// (chỉ chia sẻ trong cùng 1 process).
# Gunicorn chạy nhiều worker thì mỗi worker đếm riêng — production nên đặt
# RATELIMIT_STORAGE_URI=redis://... để giới hạn có hiệu lực toàn cục.
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[],
    storage_uri=os.getenv("RATELIMIT_STORAGE_URI", "memory://"),
)


def _jwt_error(message: str, status: int = 401):
    """Trả lỗi JWT theo đúng format của app.utils.responses.fail."""
    return jsonify({"success": False, "error": {"message": message, "code": status}}), status


@jwt.expired_token_loader
def _on_expired_token(_jwt_header, _jwt_payload):
    return _jwt_error("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại", 401)


@jwt.invalid_token_loader
def _on_invalid_token(_reason):
    return _jwt_error("Token không hợp lệ", 401)


@jwt.unauthorized_loader
def _on_missing_token(_reason):
    return _jwt_error("Thiếu token xác thực", 401)


@jwt.revoked_token_loader
def _on_revoked_token(_jwt_header, _jwt_payload):
    return _jwt_error("Token đã bị thu hồi", 401)

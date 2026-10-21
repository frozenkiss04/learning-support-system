"""Bảo mật dùng chung: user hiện tại, phân quyền, thu hồi JWT.

Module này được các blueprint import rất sớm nên các callback của
Flask-JWT-Extended (blocklist + thông báo lỗi tiếng Việt) được đăng ký tại đây
mà không cần sửa app factory.

Cơ chế thu hồi token gồm 2 lớp:
1. Bảng ``token_blocklist`` (theo jti) + tập in-memory dự phòng khi bảng chưa
   được migrate — dùng cho logout từng token.
2. Claim ``tv`` (token_version) trong JWT: đổi mật khẩu sẽ tăng
   ``user.token_version`` khiến mọi token cấp trước đó bị vô hiệu.
"""
from datetime import datetime, timezone
from functools import wraps

from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request

from ..extensions import db, jwt
from ..models.user import TokenBlocklist, User
from .responses import fail

# Dự phòng trong bộ nhớ: chỉ có tác dụng trong 1 process và mất khi restart.
# Nguồn sự thật chính là bảng token_blocklist.
_revoked_jtis_in_memory: set[str] = set()


def revoke_token(jti: str, token_type: str = "access", user_id: int | None = None,
                 expires_at: datetime | None = None) -> None:
    """Thu hồi một token theo jti (idempotent)."""
    if not jti:
        return
    _revoked_jtis_in_memory.add(jti)
    try:
        if not TokenBlocklist.query.filter_by(jti=jti).first():
            db.session.add(TokenBlocklist(
                jti=jti, token_type=token_type, user_id=user_id, expires_at=expires_at,
            ))
            db.session.commit()
    except Exception:
        db.session.rollback()  # bảng chưa migrate: vẫn còn lớp in-memory ở trên


def is_token_revoked(jti: str) -> bool:
    if not jti:
        return False
    if jti in _revoked_jtis_in_memory:
        return True
    try:
        return TokenBlocklist.query.filter_by(jti=jti).first() is not None
    except Exception:
        db.session.rollback()
        return False


@jwt.token_in_blocklist_loader
def _check_token_revoked(jwt_header, jwt_payload) -> bool:
    if is_token_revoked(jwt_payload.get("jti", "")):
        return True
    # Token cấp trước lần đổi mật khẩu gần nhất (claim tv lệch) coi như đã thu hồi.
    token_version = jwt_payload.get("tv")
    subject = jwt_payload.get("sub")
    if token_version is not None and subject is not None:
        try:
            user = db.session.get(User, int(subject))
        except (TypeError, ValueError):
            return True
        if user is None or not user.is_active:
            return True
        if int(token_version) != (user.token_version or 0):
            return True
    return False


@jwt.revoked_token_loader
def _revoked_token_response(jwt_header, jwt_payload):
    return fail("Phiên đăng nhập đã bị thu hồi, vui lòng đăng nhập lại", 401, code="TOKEN_REVOKED")


@jwt.expired_token_loader
def _expired_token_response(jwt_header, jwt_payload):
    return fail("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại", 401, code="TOKEN_EXPIRED")


@jwt.invalid_token_loader
def _invalid_token_response(reason):
    return fail("Token không hợp lệ, vui lòng đăng nhập lại", 401, code="TOKEN_INVALID")


@jwt.unauthorized_loader
def _unauthorized_response(reason):
    return fail("Bạn cần đăng nhập để thực hiện thao tác này", 401, code="UNAUTHORIZED")


@jwt.needs_fresh_token_loader
def _needs_fresh_response(jwt_header, jwt_payload):
    return fail("Thao tác này cần đăng nhập lại để xác thực", 401, code="FRESH_TOKEN_REQUIRED")


def current_user() -> User | None:
    """User đang đăng nhập từ JWT, None nếu token lạ / user đã xóa / bị khóa."""
    try:
        identity = get_jwt_identity()
        if identity is None:
            return None
        user = db.session.get(User, int(identity))
    except (TypeError, ValueError):
        return None
    if user is None or not user.is_active:
        return None
    return user


def current_token_info() -> dict:
    """Thông tin token hiện tại (jti, type, exp) — dùng cho logout."""
    claims = get_jwt()
    exp = claims.get("exp")
    return {
        "jti": claims.get("jti", ""),
        "type": claims.get("type", "access"),
        "expires_at": datetime.fromtimestamp(exp, tz=timezone.utc) if exp else None,
    }


def roles_required(*roles):
    """Admin/teacher gate. Registration never grants these roles (see auth blueprint)."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            user = current_user()
            if not user or user.role not in roles:
                return fail("Bạn không có quyền thực hiện thao tác này", 403)
            return fn(*args, **kwargs)
        return wrapper
    return decorator

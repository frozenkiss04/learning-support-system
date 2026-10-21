"""Auth blueprint: /api/auth/*

Hợp đồng với frontend (không đổi):
- POST /register          -> 201, data = user.to_dict()
- POST /login             -> data = {user, access_token, refresh_token}
- POST /refresh           -> data = {access_token}
- GET  /me                -> data = user + current_streak (+ streak chi tiết)
- POST /change-password   -> đổi mật khẩu, vô hiệu mọi token đã cấp trước đó
- POST /logout            -> thu hồi token đang mang theo (access hoặc refresh)

Nguyên tắc harden:
- Role KHÔNG BAO GIỜ lấy từ request: đăng ký công khai luôn là LEARNER.
- Login giới hạn tốc độ, thông báo lỗi chung chung để chống dò tài khoản.
- Mật khẩu tối thiểu 8 ký tự (xem models/user.password_error).
"""
from datetime import datetime, timezone

from flask import Blueprint, request
from flask_jwt_extended import create_access_token, create_refresh_token, jwt_required
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash

from ..extensions import db, limiter
from ..models.user import (
    FULL_NAME_MAX_LENGTH,
    FULL_NAME_MIN_LENGTH,
    ROLE_LEARNER,
    User,
    is_valid_email,
    normalize_email,
    password_error,
)
from ..utils.responses import fail, ok
from ..utils.security import current_token_info, current_user, revoke_token

auth_bp = Blueprint("auth", __name__)

# Hash giả để login vẫn tốn thời gian tương đương khi email không tồn tại,
# tránh lộ "email có đăng ký hay chưa" qua thời gian phản hồi.
_DUMMY_HASH = generate_password_hash("dummy-password-for-timing")

LOGIN_RATE_LIMIT = "5 per minute; 30 per hour"
REGISTER_RATE_LIMIT = "10 per minute; 50 per hour"
SENSITIVE_RATE_LIMIT = "10 per minute"


def _issue_tokens(user: User) -> dict:
    """Cấp cặp access + refresh, kèm claim role và tv (token_version)."""
    claims = {"role": user.role, "tv": user.token_version or 0}
    return {
        "access_token": create_access_token(identity=str(user.id), additional_claims=claims),
        "refresh_token": create_refresh_token(identity=str(user.id), additional_claims=claims),
    }


def _streak_payload(user: User) -> dict:
    streak = user.streak
    if not streak:
        return {"current_streak": 0,
                "streak": {"current_streak": 0, "longest_streak": 0, "last_study_date": None}}
    return {
        "current_streak": streak.current_streak,
        "streak": {
            "current_streak": streak.current_streak,
            "longest_streak": streak.longest_streak,
            "last_study_date": streak.last_study_date.isoformat() if streak.last_study_date else None,
        },
    }


@auth_bp.post("/register")
@limiter.limit(REGISTER_RATE_LIMIT)
def register():
    body = request.get_json(silent=True) or {}
    email = normalize_email(body.get("email"))
    password = body.get("password") or ""
    full_name = (body.get("full_name") or "").strip()

    if not is_valid_email(email):
        return fail("Email không đúng định dạng")
    if not (FULL_NAME_MIN_LENGTH <= len(full_name) <= FULL_NAME_MAX_LENGTH):
        return fail(f"Họ tên phải từ {FULL_NAME_MIN_LENGTH} đến {FULL_NAME_MAX_LENGTH} ký tự")
    err = password_error(password)
    if err:
        return fail(err)
    if User.query.filter_by(email=email).first():
        return fail("Email đã được đăng ký", 409)

    # body.get("role") bị bỏ qua có chủ đích: chỉ admin mới gán TEACHER/ADMIN được,
    # qua luồng quản trị riêng. Đăng ký công khai luôn là LEARNER.
    user = User(email=email, full_name=full_name, role=ROLE_LEARNER)
    user.set_password(password)
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:  # race: 2 request cùng email
        db.session.rollback()
        return fail("Email đã được đăng ký", 409)
    return ok(user.to_dict(), 201)


@auth_bp.post("/login")
@limiter.limit(LOGIN_RATE_LIMIT)
def login():
    body = request.get_json(silent=True) or {}
    email = normalize_email(body.get("email"))
    password = body.get("password") or ""

    user = User.query.filter_by(email=email).first() if email else None
    if user is None:
        # Chạy hash giả để thời gian phản hồi giống trường hợp sai mật khẩu.
        from werkzeug.security import check_password_hash
        check_password_hash(_DUMMY_HASH, password)
        return fail("Email hoặc mật khẩu không đúng", 401)
    if not user.check_password(password):
        return fail("Email hoặc mật khẩu không đúng", 401)
    if not user.is_active:
        return fail("Tài khoản đã bị khóa, vui lòng liên hệ quản trị viên", 403)

    user.last_login_at = datetime.now(timezone.utc)
    db.session.commit()
    return ok({"user": user.to_dict(), **_issue_tokens(user)})


@auth_bp.post("/refresh")
@limiter.limit(SENSITIVE_RATE_LIMIT)
@jwt_required(refresh=True)
def refresh():
    user = current_user()
    if user is None:
        return fail("Phiên đăng nhập không còn hợp lệ, vui lòng đăng nhập lại", 401)
    claims = {"role": user.role, "tv": user.token_version or 0}
    return ok({
        "access_token": create_access_token(identity=str(user.id), additional_claims=claims),
    })


@auth_bp.get("/me")
@jwt_required()
def me():
    user = current_user()
    if user is None:
        return fail("Không tìm thấy người dùng hoặc tài khoản đã bị khóa", 404)
    data = user.to_dict()
    data.update(_streak_payload(user))
    return ok(data)


@auth_bp.post("/change-password")
@limiter.limit(SENSITIVE_RATE_LIMIT)
@jwt_required()
def change_password():
    user = current_user()
    if user is None:
        return fail("Phiên đăng nhập không còn hợp lệ, vui lòng đăng nhập lại", 401)
    body = request.get_json(silent=True) or {}
    current_password = body.get("current_password") or ""
    new_password = body.get("new_password") or ""
    confirm_password = body.get("confirm_password")

    if not user.check_password(current_password):
        return fail("Mật khẩu hiện tại không đúng", 400)
    err = password_error(new_password)
    if err:
        return fail(err)
    if confirm_password is not None and confirm_password != new_password:
        return fail("Mật khẩu xác nhận không khớp")
    if new_password == current_password:
        return fail("Mật khẩu mới phải khác mật khẩu hiện tại")

    user.set_password(new_password)
    # Tăng token_version: mọi access/refresh đã cấp trước đó đều bị vô hiệu
    # ở blocklist loader (utils/security), kể cả token đang dùng ở thiết bị khác.
    user.token_version = (user.token_version or 0) + 1
    db.session.commit()
    # Trả cặp token mới (đã mang tv mới) để frontend thay token cũ và phiên
    # hiện tại không bị đá ra; mọi phiên ở thiết bị khác đã bị vô hiệu.
    return ok({"message": "Đổi mật khẩu thành công", **_issue_tokens(user)})


@auth_bp.post("/logout")
@jwt_required(verify_type=False)  # chấp nhận cả access lẫn refresh token
def logout():
    user = current_user()
    info = current_token_info()
    revoke_token(
        info["jti"],
        token_type=info["type"],
        user_id=user.id if user else None,
        expires_at=info["expires_at"],
    )
    return ok({"message": "Đăng xuất thành công"})


@auth_bp.post("/logout-all")
@limiter.limit(SENSITIVE_RATE_LIMIT)
@jwt_required()
def logout_all():
    """Đăng xuất mọi thiết bị: tăng token_version như khi đổi mật khẩu."""
    user = current_user()
    if user is None:
        return fail("Phiên đăng nhập không còn hợp lệ, vui lòng đăng nhập lại", 401)
    user.token_version = (user.token_version or 0) + 1
    db.session.commit()
    return ok({"message": "Đã đăng xuất khỏi tất cả thiết bị"})

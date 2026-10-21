import re
from datetime import datetime, timezone

from werkzeug.security import check_password_hash, generate_password_hash

from ..extensions import db

ROLE_LEARNER = "LEARNER"
ROLE_TEACHER = "TEACHER"
ROLE_ADMIN = "ADMIN"
ROLES = (ROLE_LEARNER, ROLE_TEACHER, ROLE_ADMIN)

PASSWORD_MIN_LENGTH = 8
FULL_NAME_MIN_LENGTH = 2
FULL_NAME_MAX_LENGTH = 120
EMAIL_MAX_LENGTH = 255

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


def normalize_email(raw: str | None) -> str:
    """Chuẩn hoá email: bỏ khoảng trắng, viết thường. Trả '' nếu rỗng."""
    return (raw or "").strip().lower()


def is_valid_email(email: str) -> bool:
    return bool(email) and len(email) <= EMAIL_MAX_LENGTH and bool(_EMAIL_RE.match(email))


def password_error(raw: str | None) -> str | None:
    """Trả thông báo lỗi tiếng Việt nếu mật khẩu không hợp lệ, None nếu hợp lệ."""
    if not raw:
        return "Mật khẩu là bắt buộc"
    if len(raw) < PASSWORD_MIN_LENGTH:
        return f"Mật khẩu phải có tối thiểu {PASSWORD_MIN_LENGTH} ký tự"
    if raw.strip() != raw or raw.strip() == "":
        return "Mật khẩu không được chứa khoảng trắng ở đầu hoặc cuối"
    return None


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(EMAIL_MAX_LENGTH), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    full_name = db.Column(db.String(FULL_NAME_MAX_LENGTH), nullable=False)
    role = db.Column(db.String(20), nullable=False, default=ROLE_LEARNER)
    xp = db.Column(db.Integer, nullable=False, default=0)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    # Tăng mỗi khi đổi mật khẩu / bị khóa: token JWT mang claim "tv" khác giá trị
    # này sẽ bị coi là đã thu hồi (xem utils/security.py).
    token_version = db.Column(db.Integer, nullable=False, default=0)
    last_login_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    streak = db.relationship("Streak", back_populates="user", uselist=False)

    @property
    def is_admin(self) -> bool:
        return self.role == ROLE_ADMIN

    @property
    def is_teacher(self) -> bool:
        return self.role == ROLE_TEACHER

    def set_password(self, raw: str) -> None:
        self.password_hash = generate_password_hash(raw)

    def check_password(self, raw: str) -> bool:
        if not raw or not self.password_hash:
            return False
        return check_password_hash(self.password_hash, raw)

    def to_dict(self):
        return {
            "id": self.id, "email": self.email, "full_name": self.full_name,
            "role": self.role, "xp": self.xp, "is_active": self.is_active,
            "last_login_at": self.last_login_at.isoformat() if self.last_login_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<User id={self.id} email={self.email!r} role={self.role}>"


class TokenBlocklist(db.Model):
    """JWT đã bị thu hồi (logout / đổi mật khẩu qua token_version).

    Lưu theo ``jti`` để việc thu hồi tồn tại qua restart và dùng chung được
    giữa các worker Gunicorn, thay vì chỉ giữ trong bộ nhớ.
    """

    __tablename__ = "token_blocklist"

    id = db.Column(db.Integer, primary_key=True)
    jti = db.Column(db.String(36), unique=True, nullable=False, index=True)
    token_type = db.Column(db.String(20), nullable=False, default="access")  # access | refresh
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True, index=True)
    expires_at = db.Column(db.DateTime, nullable=True)  # hạn gốc của token (claim exp)
    revoked_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

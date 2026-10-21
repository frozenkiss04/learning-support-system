"""Application configuration — mọi giá trị nhạy cảm/có thể thay đổi đều qua env.

Production target: Render (BE) + Neon (Postgres). Local không cần env nào:
thiếu DATABASE_URL thì tự rơi về SQLite để chạy thử ngay.
"""
import os
from datetime import timedelta
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

try:  # Local dev: nạp .env nếu có. Env thật trên Render luôn thắng (không override).
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover - python-dotenv luôn có trong requirements
    pass

_DEV_SECRET = "dev-secret-change-me"
_DEV_JWT_SECRET = "dev-jwt-secret-change-me"


def _normalize_database_url(raw: str) -> str:
    """Chuẩn hoá DATABASE_URL của Neon/Postgres cho SQLAlchemy + psycopg3.

    - ``postgres://`` / ``postgresql://`` -> ``postgresql+psycopg://``
    - Host Neon chưa có ``-pooler`` -> tự chuyển sang pooled endpoint
      (endpoint trực tiếp rất nhanh hết connection khi deploy serverless).
    - Thiếu ``sslmode`` -> ép ``sslmode=require`` (Neon bắt buộc SSL).
    """
    url = (raw or "").strip()
    if not url:
        return "sqlite:///dev.db"
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    if not url.startswith("postgresql"):
        return url  # sqlite://... hoặc URL đã có driver lạ — giữ nguyên

    parts = urlparse(url)
    host = parts.hostname or ""
    if host.endswith("neon.tech") and "-pooler" not in host:
        first, _, rest = host.partition(".")
        host = f"{first}-pooler.{rest}"
        netloc = host
        if parts.username:
            auth = parts.username
            if parts.password:
                auth += f":{parts.password}"
            netloc = f"{auth}@{host}"
        if parts.port:
            netloc += f":{parts.port}"
        parts = parts._replace(netloc=netloc)

    query = dict(parse_qsl(parts.query))
    if "sslmode" not in query:
        query["sslmode"] = "require"
        parts = parts._replace(query=urlencode(query))
    return urlunparse(parts)


def _cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000")
    return [o.strip() for o in raw.split(",") if o.strip()]


class Config:
    ENV = os.getenv("FLASK_ENV", "development")

    SECRET_KEY = os.getenv("SECRET_KEY", _DEV_SECRET)
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", _DEV_JWT_SECRET)
    # Flask-JWT-Extended chuẩn: timedelta (không dùng số giây thô).
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=int(os.getenv("JWT_ACCESS_MINUTES", "30")))
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=int(os.getenv("JWT_REFRESH_DAYS", "7")))

    SQLALCHEMY_DATABASE_URI = _normalize_database_url(os.getenv("DATABASE_URL", ""))
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Neon tự suspend compute khi idle: pool_pre_ping loại connection đã chết,
    # pool_recycle < thời gian suspend, pool nhỏ vì đã qua PgBouncer của Neon.
    # SQLite local không nhận connect_args/pool của Postgres nên phải tách riêng.
    if SQLALCHEMY_DATABASE_URI.startswith("postgresql"):
        SQLALCHEMY_ENGINE_OPTIONS = {
            "pool_pre_ping": True,
            "pool_recycle": 280,
            "pool_size": 5,
            "max_overflow": 5,
            "pool_timeout": 30,
            "connect_args": {"connect_timeout": 10},
        }
    else:
        SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True}

    # Chỉ domain FE (Vercel) + localhost dev, cấu hình qua env CORS_ORIGINS.
    CORS_ORIGINS = _cors_origins()

    # Flask-Limiter: memory:// chỉ đúng khi 1 worker. Nhiều worker/production
    # thì đặt RATELIMIT_STORAGE_URI=redis://... (xem extensions.py).
    RATELIMIT_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI", "memory://")

    AI_DAILY_LIMIT = int(os.getenv("AI_DAILY_LIMIT", "50"))


if Config.ENV == "production" and (
    Config.SECRET_KEY == _DEV_SECRET or Config.JWT_SECRET_KEY == _DEV_JWT_SECRET
):
    raise RuntimeError(
        "SECRET_KEY/JWT_SECRET_KEY chưa được đặt trong env production. "
        "Trên Render: hai biến này để generateValue/sync:false và phải nhập giá trị thật."
    )

"""Application factory."""
import logging
import os

from flask import Flask

from .config import Config
from .extensions import cors, db, jwt, limiter, migrate


def create_app(config_object=Config):
    # Cho phép log INFO của package app (vd thời gian phản hồi AI stream)
    # hiện trên Render — mặc định root logger ở WARNING sẽ nuốt chúng.
    logging.getLogger("app").setLevel(
        getattr(logging, os.getenv("APP_LOG_LEVEL", "INFO").upper(),
                logging.INFO))

    app = Flask(__name__)
    app.config.from_object(config_object)

    # Sau Render proxy, REMOTE_ADDR là IP của proxy nếu không có ProxyFix —
    # rate limit (key theo IP) sẽ đếm gộp mọi user thành 1. Chỉ tin 1 tầng
    # proxy (Render) qua X-Forwarded-*.
    from werkzeug.middleware.proxy_fix import ProxyFix

    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    cors.init_app(
        app,
        resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
        supports_credentials=True,
    )
    limiter.init_app(app)

    # Gzip JSON responses (course lists / leaderboards shrink ~70%),
    # which noticeably speeds up first paint on slow connections.
    from flask_compress import Compress

    Compress(app)

    from .models import chat, course, gamification, learning, practice, rag, review, user  # noqa: F401  (register models)

    from .blueprints.admin import admin_bp
    from .blueprints.ai_chat import ai_bp
    from .blueprints.auth import auth_bp
    from .blueprints.courses import courses_bp
    from .blueprints.health import health_bp
    from .blueprints.progress import progress_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(courses_bp, url_prefix="/api")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(ai_bp, url_prefix="/api/ai")
    app.register_blueprint(progress_bp, url_prefix="/api/progress")

    from .seed import register_seed_cli

    register_seed_cli(app)

    # Lỗi HTTP toàn cục trả JSON đúng format fail(...) thay vì trang HTML
    # mặc định của Flask (frontend chỉ biết parse JSON). Không ảnh hưởng
    # blueprint health: /health thành công vẫn 200 qua ok(), chỉ khi DB
    # chết nó tự trả 503 JSON (xem blueprints/health.py).
    from .utils.responses import fail

    @app.errorhandler(404)
    def _handle_404(error):
        return fail("Không tìm thấy tài nguyên", 404)

    @app.errorhandler(405)
    def _handle_405(error):
        return fail("Phương thức không được hỗ trợ cho đường dẫn này", 405)

    @app.errorhandler(429)
    def _handle_429(error):
        # Flask-Limiter ném HTTPException 429 khi vượt giới hạn (vd AI chat
        # 30/giờ): mặc định Flask trả trang HTML, frontend không parse được.
        return fail("Bạn đã gửi quá nhiều yêu cầu, vui lòng thử lại sau", 429)

    @app.errorhandler(500)
    def _handle_500(error):
        db.session.rollback()
        return fail("Lỗi máy chủ, vui lòng thử lại sau", 500)

    return app

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
    return app

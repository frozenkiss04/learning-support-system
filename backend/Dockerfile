# syntax=docker/dockerfile:1
# Backend image — dùng khi deploy Render dạng Docker (root directory: backend).
# Đường deploy chính của repo là render.yaml (Python native) ở root repo;
# Dockerfile này là phương án thay thế tương đương, cùng lệnh gunicorn.
#
# Tối ưu tốc độ build:
# - Layer requirements tách riêng: chỉ cài lại thư viện khi requirements.txt đổi,
#   các lần build sửa code chỉ tốn vài giây ở layer COPY code.
# - BuildKit cache mount cho pip: wheel đã tải được giữ lại giữa các lần build
#   (kể cả khi requirements đổi ít), không tải lại toàn bộ từ PyPI.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    WEB_CONCURRENCY=2

WORKDIR /app

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

COPY . .

# Không chạy bằng root.
RUN useradd --create-home appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD-SHELL python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.getenv(\"PORT\", \"10000\")}/health', timeout=4)"

# Render tự cấp $PORT; WEB_CONCURRENCY (env của gunicorn) quyết định số worker,
# chỉnh được ngay trên Render mà không build lại image. --timeout 120 cho AI chat.
CMD ["sh", "-c", "flask --app wsgi seed && gunicorn wsgi:app --bind 0.0.0.0:${PORT:-10000} --threads 4 --worker-class gthread --timeout 120 --access-logfile - --error-logfile -"]

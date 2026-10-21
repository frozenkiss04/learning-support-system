# Kiến trúc hệ thống

Tài liệu này mô tả kiến trúc **đúng với code hiện tại** trong repo (trạng thái scaffold/MVP). Phần nào chưa triển khai được ghi rõ là "chưa có / dự kiến".

## 1. Tổng quan

Hệ thống 3 tầng tách riêng, deploy độc lập:

```
┌────────────────────┐      HTTPS / JSON       ┌────────────────────┐
│  Frontend (Vercel) │ ──────────────────────▶ │  Backend (Render)  │
│  React 18 + Vite   │   Authorization: Bearer │  Flask 3 + Gunicorn│
│  Tailwind CSS 3    │ ◀────────────────────── │  Blueprint theo    │
└────────────────────┘   SSE cho AI stream     │  module            │
                                               └─────────┬──────────┘
                                                         │ SQLAlchemy
                                                         │ psycopg 3 (pooled)
                                                         ▼
                                               ┌────────────────────┐
                                               │  Neon Postgres     │
                                               └────────────────────┘
                                               Backend ──▶ Gemini / OpenAI API
                                                         (AI key chỉ ở env backend)
```

- Frontend là SPA (React Router), không chứa secret nào; biến `VITE_API_URL` là công khai.
- Mọi lời gọi AI đi qua backend (`/api/ai/...`) để giấu API key, gắn ngữ cảnh bài học, giới hạn tần suất và lưu lịch sử hội thoại.
- Database dùng chung một Neon project cho production; local dev dùng SQLite khi `DATABASE_URL` để trống.

## 2. Backend (Flask)

### Application factory

`backend/app/__init__.py` cung cấp `create_app()`:

1. Nạp `Config` từ `app/config.py` (đọc env).
2. Khởi tạo extensions dùng chung từ `app/extensions.py`: `db` (SQLAlchemy), `migrate` (Flask-Migrate), `jwt` (Flask-JWT-Extended), `cors` (Flask-CORS, chỉ áp cho `/api/*`), `limiter` (Flask-Limiter).
3. Import các model để SQLAlchemy đăng ký metadata.
4. Đăng ký blueprint và CLI `seed`.

Entrypoint là `backend/wsgi.py` (`app = create_app()`), chạy dev bằng `flask --app wsgi run`, production bằng Gunicorn (xem `backend/Dockerfile`: 2 workers × 4 threads, timeout 120s).

### Blueprint theo module

| Blueprint | File | Prefix | Trách nhiệm |
| --- | --- | --- | --- |
| health | `blueprints/health.py` | (không prefix) | `GET /health` — kiểm tra service + DB (`SELECT 1`) |
| auth | `blueprints/auth.py` | `/api/auth` | Đăng ký, đăng nhập, refresh token, thông tin user hiện tại |
| courses | `blueprints/courses.py` | `/api` | Khóa học, lộ trình, chi tiết bài, nộp bài (progress), bảng xếp hạng |
| admin | `blueprints/admin.py` | `/api/admin` | Thống kê, quản lý user (đọc), tạo khóa/chương, bài học yếu |
| ai | `blueprints/ai_chat.py` | `/api/ai` | Chat AI thường + stream SSE, danh sách session |

Hiện **chưa có blueprint `progress` riêng**: các endpoint tiến độ (nộp bài, lộ trình kèm trạng thái, streak trong `/api/auth/me`) nằm trong blueprint `courses` và `auth`. Nếu tách module sau này, giữ nguyên URL để không phá frontend.

### Tầng service

Blueprint chỉ làm HTTP (parse request, kiểm tra quyền, trả response). Logic nghiệp vụ nằm ở `app/services/`:

- `progress_service.grade_lesson(user, lesson, answers)`: chấm từng exercise (so khớp đáp án không phân biệt hoa thường, có trim), ghi `Attempt` cho mọi câu, tính điểm %, đạt khi ≥ 80%. Khi đạt lần đầu: chuyển `UserProgress` sang `COMPLETED`, cộng `xp_reward` (chỉ một lần), chạm streak (`Streak.touch()` xử lý logic ngày liên tiếp).
- `ai_service.AiService`: lớp trừu tượng provider. `chat(messages, system)` và `stream(...)` là 2 điểm vào duy nhất; provider chọn qua env `AI_PROVIDER` (`gemini` mặc định, hoặc nhánh OpenAI). Chưa có API key tương ứng → **stub mode**: trả câu trả lời mẫu có ghi rõ "[Chế độ stub — chưa cấu hình API key AI]". `stream()` hiện chia nhỏ câu trả lời hoàn chỉnh thành từng từ để phát qua SSE (chưa phải token streaming thật từ provider).

### Format response thống nhất

`app/utils/responses.py`:

- Thành công: `{ "success": true, "data": ... }` (kèm meta phân trang `total`, `page`, `per_page` ở một số endpoint danh sách).
- Lỗi: `{ "success": false, "error": { "message": "...", "code": <http status> } }`.

## 3. Mô hình dữ liệu

| Bảng | Model | Trường / quan hệ chính |
| --- | --- | --- |
| `users` | `models/user.py: User` | `email` unique, `password_hash` (Werkzeug hash), `full_name`, `role` (`LEARNER`/`TEACHER`/`ADMIN`), `xp`, `is_active` |
| `courses` | `models/course.py: Course` | `title`, `slug` unique, `description`, `level`, `is_published`, `created_by` → users |
| `units` | `models/course.py: Unit` | `course_id` → courses, `title`, `order_index`; xóa course xóa theo cascade |
| `lessons` | `models/learning.py: Lesson` | `unit_id` → units, `title`, `description`, `order_index`, `xp_reward` |
| `exercises` | `models/learning.py: Exercise` | `lesson_id` → lessons, `type` (`MULTIPLE_CHOICE`/`FILL_BLANK`/`MATCHING`/`TRANSLATE`), `question`, `options` (JSON), `correct_answer`, `explanation` |
| `user_progress` | `models/learning.py: UserProgress` | unique (`user_id`, `lesson_id`), `status` (`IN_PROGRESS`/`COMPLETED`), `score` 0–100, `completed_at` |
| `attempts` | `models/learning.py: Attempt` | `user_id`, `exercise_id`, `answer`, `is_correct` — dữ liệu thô cho thống kê/bài học yếu |
| `streaks` | `models/learning.py: Streak` | PK là `user_id`, `current_streak`, `longest_streak`, `last_study_date` |
| `chat_sessions` | `models/chat.py: ChatSession` | `user_id`, `context_type` (`LESSON`/`ADMIN`), `context_id` (lesson id), `title` |
| `chat_messages` | `models/chat.py: ChatMessage` | `session_id` → chat_sessions, `role` (`user`/`assistant`/`system`), `content` |

Cấu trúc nội dung là cây cố định: Course → Unit → Lesson → Exercise. Trạng thái bài trên lộ trình (`COMPLETED` / `AVAILABLE` / `LOCKED`) là giá trị **suy ra** khi trả API, không lưu trong DB (hiện backend trả `COMPLETED`/`AVAILABLE`; `LOCKED` mới là hằng số dự kiến trong model).

## 4. Các luồng chính

### Đăng nhập

1. `POST /api/auth/login` → kiểm tra email + mật khẩu + `is_active`.
2. Trả `access_token` (30 phút, claim kèm `role`) + `refresh_token` (7 ngày).
3. Frontend (Zustand auth store) giữ token, gọi API kèm `Authorization: Bearer <access_token>`; hết hạn thì `POST /api/auth/refresh` với refresh token.

### Làm bài và nộp bài

1. `GET /api/courses/:id/path` (JWT tùy chọn) → cây unit/lesson; nếu có token, lesson đã xong được đánh dấu `COMPLETED` kèm điểm.
2. `GET /api/lessons/:id` (bắt buộc JWT) → bài tập **không kèm** `correct_answer`/`explanation` (model `Exercise.to_dict()` mặc định loại 2 trường này).
3. `POST /api/lessons/:id/submit` với `{ "answers": { "<exercise_id>": "<đáp án>" } }` → `grade_lesson()` chấm, ghi attempts/progress/XP/streak, trả `{ score, passed, correct, total, xp_earned, details }` — đáp án đúng + giải thích chỉ lộ **sau** khi nộp.

### AI chat

1. `POST /api/ai/chat` (JWT, giới hạn 30 req/giờ): tạo mới hoặc dùng lại `ChatSession` của chính user đó; nếu `context_type=LESSON` và có `context_id`, system prompt được cộng thêm tiêu đề bài học.
2. `context_type=ADMIN` bị chặn 403 nếu user không phải `ADMIN`/`TEACHER`; system prompt yêu cầu AI chỉ trả lời theo số liệu được cung cấp.
3. Cả tin nhắn user và assistant đều lưu vào `chat_messages`; toàn bộ lịch sử session được gửi kèm mỗi lần gọi provider để giữ ngữ cảnh.
4. Bản stream `POST /api/ai/chat/stream` trả SSE: nhiều sự kiện `data: {"delta": "..."}` rồi kết thúc bằng `data: [DONE]`.

## 5. Bảo mật

- Mật khẩu băm bằng Werkzeug (`generate_password_hash`), không lưu plaintext.
- Đăng ký công khai **không** nhận `role` từ request — luôn là `LEARNER`. Quyền `ADMIN`/`TEACHER` chỉ gán qua seed/quản trị DB.
- Phân quyền bằng decorator `roles_required(...)` (`app/utils/security.py`): `ADMIN`/`TEACHER` cho đọc thống kê; riêng tạo khóa/chương chỉ `ADMIN`.
- Mọi endpoint bài học, nộp bài, leaderboard, AI đều bắt buộc JWT; endpoint quản trị kiểm tra role ở server, không dựa vào ẩn/hiện ở frontend.
- CORS: chỉ áp cho `/api/*`, origin lấy từ env `CORS_ORIGINS` (danh sách phân tách bằng dấu phẩy), bật `supports_credentials`. Production chỉ nên chứa domain Vercel + (khi cần) localhost.
- Secret (JWT, DB, AI key) chỉ qua env; repo chỉ chứa `.env.example` không có giá trị thật.
- Rate limit: Flask-Limiter cấu hình mặc định rỗng, đang áp cụ thể 30 req/giờ cho 2 endpoint AI chat. `AI_DAILY_LIMIT` đã có trong config/env nhưng **chưa** được enforce trong code — đừng mô tả là đã giới hạn theo ngày.

## 6. Cấu hình & môi trường

`app/config.py`:

- `DATABASE_URL`: nếu là URL Neon/Postgres (`postgres://` hoặc `postgresql://`) sẽ tự chuẩn hóa sang driver `postgresql+psycopg://` và tự thêm `sslmode=require` cho host `neon.tech`. Để trống → SQLite `dev.db`.
- Engine options: `pool_pre_ping=True`, `pool_recycle=300`, `pool_size=5` — phù hợp với Neon pooler và việc Neon suspend compute khi idle.
- Biến môi trường đầy đủ: xem `backend/.env.example` và [DEPLOY.md](DEPLOY.md).

## 7. Frontend

React 18 + Vite, tổ chức trong `frontend/src/`: `components/` (ui, learning, exercise, ai, admin), `layouts/`, `pages/` (auth, learner, admin), `lib/` (axios client + React Query keys), `routes/ProtectedRoute`, `stores/` (Zustand auth store). Gọi API qua một axios instance dùng `VITE_API_URL` làm base URL; dev có thêm proxy `/api` → `localhost:5000` trong `vite.config.js`. Chuẩn giao diện xem [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

Trạng thái tại thời điểm viết: frontend là scaffold đang được bổ sung page/component song song — kiểm tra cây thư mục thực tế trước khi khẳng định một màn hình đã xong.

## 8. Hạ tầng deploy

- **Neon**: Postgres production, dùng pooled connection string.
- **Render**: chạy backend từ `backend/` (Docker hoặc Python + Gunicorn), health check `/health`.
- **Vercel**: build frontend từ `frontend/`, `vercel.json` rewrite mọi route về `/index.html` cho SPA.

Chi tiết từng bước: [DEPLOY.md](DEPLOY.md).

## 9. Giới hạn hiện tại (biết để không hứa quá)

- Chưa có migration scripts Alembic — schema tạo bằng `db.create_all()` qua `flask seed`; thay đổi model chưa có quy trình nâng cấp DB chính thức.
- AI stream là chia từ trên câu trả lời đầy đủ, chưa phải streaming token thật; chưa có tóm tắt/cắt lịch sử chat dài.
- `GET /api/admin/lessons/weakest` đang ở mức cơ bản (chưa trả về tỉ lệ đúng hoàn chỉnh để xếp hạng).
- Chưa có test tự động, chưa có CI.
- Chưa có SRS, hearts, bài nghe/nói — thuộc roadmap ở README.

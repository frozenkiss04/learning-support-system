# INTEGRATION NOTES — learning-support-system

> File tổng hợp cho agent chính khi merge công việc của các worker song song.
> Snapshot QA gần nhất: 2026-10-21 15:57 UTC, chạy `bash scripts/check.sh` → **FAIL=0, WARN=0, exit 0**.
> Lưu ý: repo đang được nhiều worker ghi đồng thời — file nào "thiếu" ở thời điểm
> kiểm tra có thể xuất hiện vài phút sau. Ghi nhận dưới đây theo trạng thái thật lúc snapshot cuối.

---

## 1. Blueprint cần đăng ký (backend/app/__init__.py)

Đã đăng ký trong `create_app()`:

| Blueprint | Prefix | File |
|---|---|---|
| `health_bp` | _(không prefix)_ → `GET /health` | `blueprints/health.py` |
| `auth_bp` | `/api/auth` | `blueprints/auth.py` |
| `courses_bp` | `/api` | `blueprints/courses.py` |
| `admin_bp` | `/api/admin` | `blueprints/admin.py` |
| `ai_bp` | `/api/ai` | `blueprints/ai_chat.py` |

### ⚠️ HÀNH ĐỘNG CẦN LÀM — `progress_bp` (worker 03)

- File `backend/app/blueprints/progress.py` **đã tồn tại**, định nghĩa `progress_bp` với các route:
  - `GET /due`
  - `POST /review/<int:exercise_id>`
  - `GET /summary`
- Nhưng tại thời điểm snapshot, `backend/app/__init__.py` **chưa import/chưa đăng ký** `progress_bp`.
- Agent chính cần thêm vào `create_app()`:

```python
from .blueprints.progress import progress_bp
app.register_blueprint(progress_bp, url_prefix="/api/progress")
```

- Sau khi đăng ký, URL đầy đủ sẽ là: `GET /api/progress/due`, `POST /api/progress/review/<exercise_id>`, `GET /api/progress/summary`.
- Chú ý tránh trùng lặp: logic chấm bài/cập nhật tiến độ hiện cũng nằm trong
  `courses_bp` (`POST /api/lessons/<id>/submit` → `services/progress_service.grade_lesson`).
  `progress_bp` phụ trách phần ôn tập SRS (due/review/summary) — hai bên bổ sung nhau, không thay thế.

## 2. Route FE cần khớp (frontend/src/App.jsx)

Đã có trong `App.jsx` tại snapshot:

| Route FE | Trang | Quyền |
|---|---|---|
| `/login` | LoginPage | public |
| `/register` | RegisterPage | public |
| `/learn` | LearnPage (lộ trình học) | learner (ProtectedRoute) |
| `/lesson/:lessonId` | LessonPage (làm bài + panel AI) | learner |
| `/leaderboard` | LeaderboardPage | learner |
| `/profile` | ProfilePage | learner |
| `/admin` | AdminDashboard | admin/teacher |
| `/admin/courses` | AdminCourses | admin/teacher |
| `/admin/users` | AdminUsers | admin/teacher |
| `/admin/ai` | AdminAiAssistant | admin/teacher |
| `*` (fallback) | redirect → `/learn` | — |

Cần agent chính đối chiếu khi các page còn lại được worker FE bàn giao đủ
(LoginPage, RegisterPage, LearnPage, LessonPage, ProfilePage, AdminDashboard,
AdminCourses, AdminAiAssistant đã được import trong App.jsx — kiểm tra file vật lý tương ứng trong `frontend/src/pages/`).

## 3. API contract FE ↔ BE

### Envelope dùng chung (`backend/app/utils/responses.py`)

- Thành công: `{ "success": true, "data": <payload>, ...meta }` (list có thể kèm `total`, `page`, `per_page`).
- Lỗi: `{ "success": false, "error": { "message": <string>, "code": <int> } }`.
- FE (`frontend/src/lib/api.js`, axios) phải unwrap `.data.data` và đọc lỗi từ `.error.message`.

### Base URL

- FE đọc `VITE_API_URL` (không có hậu tố `/api`, không trailing slash), mặc định `http://localhost:5000`.
- Mọi call FE phải tự ghép prefix `/api/...` như bảng dưới.

### Endpoint BE hiện có

Auth (`/api/auth`):
- `POST /api/auth/register` — body `{email, password (>=8), full_name}`; role luôn là `LEARNER` (không nhận role từ client).
- `POST /api/auth/login` — trả `{user, access_token, refresh_token}`.
- `POST /api/auth/refresh` — cần refresh JWT.
- `GET /api/auth/me` — user + `current_streak`.

Học tập (`courses_bp`, prefix `/api`):
- `GET /api/courses` — khóa đã publish.
- `GET /api/courses/<course_id>/path` — units → lessons + trạng thái của user (JWT optional).
- `GET /api/lessons/<lesson_id>` — kèm exercises, **không** trả `correct_answer` cho learner.
- `POST /api/lessons/<lesson_id>/submit` — body `{answers: {exercise_id: answer}}`; trả `{score, passed (>=80), correct, total, xp_earned, details[]}`.
- `GET /api/leaderboard` — top 20 theo XP.

Tiến độ / SRS (`progress_bp`, prefix `/api/progress` — **chờ đăng ký, xem mục 1**):
- `GET /api/progress/due`, `POST /api/progress/review/<exercise_id>`, `GET /api/progress/summary`.

Admin (`/api/admin`, yêu cầu role ADMIN; một số GET cho cả TEACHER):
- `GET /api/admin/stats`, `GET /api/admin/users?q=&page=&per_page=`,
  `POST /api/admin/courses`, `POST /api/admin/courses/<id>/units`,
  `GET /api/admin/lessons/weakest`.

AI (`/api/ai`, JWT, rate-limit 30 req/giờ ở tầng limiter):
- `POST /api/ai/chat` — body `{message, session_id?, context_type: LESSON|ADMIN, context_id?}`; trả `{session_id, reply}`.
  `context_type=ADMIN` chỉ ADMIN/TEACHER mới dùng được.
- `POST /api/ai/chat/stream` — SSE: các event `data: {"delta": "..."}` và kết thúc `data: [DONE]`.
- `GET /api/ai/sessions`.

Health: `GET /health` → `{service, database: up|down}`.

## 4. Env vars tổng hợp (chỉ tên biến — giá trị để ở .env/Render/Vercel, không commit)

Backend (`backend/.env.example`, set trên Render):
- `SECRET_KEY`, `JWT_SECRET_KEY`
- `DATABASE_URL` — Neon **pooled** connection string (host chứa `-pooler`); để trống = SQLite local.
- `CORS_ORIGINS` — danh sách origin FE cách nhau dấu phẩy (localhost:5173 local; domain Vercel khi prod).
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` — dùng cho `flask seed` tạo admin đầu tiên.
- AI: `AI_PROVIDER` (`gemini` | `openai`), `AI_MODEL`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `AI_DAILY_LIMIT`.

Frontend (`frontend/.env.example`, set trên Vercel):
- `VITE_API_URL` — base URL của BE Render (không kèm `/api`).

## 5. Kiểm tra QA baseline

- Script: `scripts/check.sh` (đã `chmod +x`).
  1. `python3 -m compileall backend/app` — hard check.
  2. Validate `frontend/package.json` bằng `node -e` (JSON.parse) — hard check nếu file tồn tại.
  3. Liệt kê file kỳ vọng (backend + frontend) — soft check, file thiếu chỉ tính WARN.
- Kết quả lần chạy cuối (2026-10-21 15:57 UTC): **PASS compile, PASS package.json, 31/31 file kỳ vọng có mặt, FAIL=0 WARN=0, exit 0.**
- `.gitignore` root đã có: Python (`__pycache__`, `.venv`), Node (`node_modules`, `dist`), `.env*` (trừ `.env.example`), `instance/`, `*.db`/`*.sqlite3`. `frontend/.gitignore` bổ sung cho riêng thư mục FE.

## 6. Việc còn tồn đọng / điểm cần agent chính quyết

1. **Đăng ký `progress_bp`** vào `app/__init__.py` với prefix `/api/progress` (mục 1) — chưa làm tại snapshot.
2. **Migrations**: mới có `backend/migrations/README.md`, chưa `flask db init`. Production hiện dựa vào `flask seed` (`db.create_all()`); cần chốt quy trình migrate trước khi lên Neon.
3. **`GET /api/admin/lessons/weakest`**: implementation truy vấn thống kê theo lesson cần review lại độ đúng (join qua exercises) và test với dữ liệu thật.
4. **Giới hạn AI**: config có `AI_DAILY_LIMIT` nhưng enforcement hiện là Flask-Limiter `30 per hour` trong `ai_chat.py` — cần thống nhất một cơ chế.
5. **Đối chiếu page FE**: đảm bảo mọi component được `App.jsx` import đều có file thật trong `frontend/src/pages/**` khi worker FE bàn giao xong; chạy lại `scripts/check.sh` + `npm run build` trong `frontend/` để xác nhận.
6. **Chưa chạy runtime test**: baseline mới ở mức compile + cấu trúc file. Cần smoke test thật: `flask seed` → login admin/learner → submit lesson → chat stub (chưa có AI key thì `AiService` trả stub, đúng thiết kế).
7. Chưa có `README.md` root và `render.yaml` — thuộc phần việc của worker docs/agent chính, không thuộc QA baseline.

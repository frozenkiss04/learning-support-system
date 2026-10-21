# Learning Support System

Hệ thống hỗ trợ học tập theo mô hình Duolingo (lộ trình học theo khóa → chương → bài → bài tập, XP, streak, bảng xếp hạng), tích hợp **AI chatbot** cho cả học viên (gia sư trong bài học) và quản trị viên (trợ lý quản lý), giao diện theo chuẩn doanh nghiệp.

> **Trạng thái: scaffold / MVP đang hoàn thiện.**
> Backend Flask đã có phần lõi (auth JWT, khóa học, chấm bài, XP/streak, admin cơ bản, AI chat + bản stub khi chưa có API key). Frontend React đang ở mức scaffold (nền tảng: routing, auth store, design system, một số page/component) và đang được bổ sung dần. Migration Alembic chưa được khởi tạo (thư mục `backend/migrations/` hiện chỉ có README hướng dẫn) — lần chạy đầu dùng `flask seed` để tạo bảng. Các mục chưa xong được ghi rõ trong [Roadmap](#roadmap), không coi là đã hoàn thành.

## Tính năng

**Đã có ở backend (MVP):**

- Đăng ký / đăng nhập JWT (access token 30 phút + refresh token 7 ngày). Đăng ký công khai luôn gán vai trò `LEARNER` — không tự gán quyền quản trị.
- Khóa học đã xuất bản, lộ trình học (course → unit → lesson) kèm trạng thái hoàn thành của từng bài.
- Làm bài và nộp bài: chấm tự động, đạt từ 80% mới hoàn thành, cộng XP **một lần duy nhất** cho mỗi bài, cập nhật streak theo ngày. Đáp án đúng không bao giờ gửi xuống cho học viên trước khi nộp.
- Bảng xếp hạng theo XP (top 20).
- Trang quản lý (vai trò `ADMIN` / `TEACHER`): thống kê tổng quan, danh sách người dùng có tìm kiếm + phân trang, tạo khóa học / chương, danh sách bài học yếu (tỉ lệ đúng thấp).
- AI chat: hội thoại lưu theo session, gắn ngữ cảnh bài học; bản stream qua SSE; giới hạn 30 req/giờ. Chế độ trợ lý quản lý (`context_type=ADMIN`) chỉ dành cho `ADMIN` / `TEACHER`. Chưa cấu hình API key thì AI chạy **chế độ stub** và nói rõ điều đó trong câu trả lời.

**Đang hoàn thiện ở frontend:** app shell học viên + admin, các page học/làm bài/bảng xếp hạng, panel AI chat, các page quản trị. Xem `frontend/src/`.

**Chưa có (roadmap):** ôn tập SRS, hearts/lives, bài tập nghe/nói, thông báo, migration scripts — xem mục Roadmap.

## Tech stack

| Tầng | Công nghệ |
| --- | --- |
| Frontend | React 18 + Vite 5, Tailwind CSS 3, React Router 6, TanStack Query 5, Zustand, Axios, React Hook Form + Zod, lucide-react |
| Backend | Python 3.12, Flask 3 (application factory + Blueprint theo module), Flask-SQLAlchemy, Flask-Migrate (Alembic), Flask-JWT-Extended, Flask-CORS, Flask-Limiter, Gunicorn |
| Database | PostgreSQL trên Neon (production) — SQLite khi chạy local không cần cấu hình |
| AI | Gemini (`gemini-2.0-flash` mặc định) hoặc OpenAI, gọi qua backend — đổi provider bằng env, xem `backend/app/services/ai_service.py` |
| Deploy | FE: Vercel · BE: Render · DB: Neon — xem [docs/DEPLOY.md](docs/DEPLOY.md) |

## Cấu trúc thư mục

```
learning-support-system/
├── backend/                  # Flask API
│   ├── app/
│   │   ├── __init__.py       # create_app() — factory, đăng ký blueprint
│   │   ├── config.py         # cấu hình từ env (DATABASE_URL Neon/SQLite, CORS, JWT)
│   │   ├── extensions.py     # db, migrate, jwt, cors, limiter
│   │   ├── blueprints/       # auth, courses, admin, ai_chat, health
│   │   ├── models/           # user, course, learning, chat
│   │   ├── services/         # progress_service (chấm bài/XP/streak), ai_service
│   │   ├── utils/            # responses (format JSON chung), security (roles_required)
│   │   └── seed.py           # lệnh `flask seed`: admin đầu tiên + khóa mẫu
│   ├── migrations/           # Flask-Migrate (chưa init — xem README trong thư mục)
│   ├── requirements.txt
│   ├── Dockerfile            # dùng được cho Render (Gunicorn)
│   ├── wsgi.py               # entrypoint: app = create_app()
│   └── .env.example
├── frontend/                 # React Vite SPA
│   ├── src/
│   │   ├── components/       # ui, learning, exercise, ai, admin
│   │   ├── layouts/          # app shell học viên / admin
│   │   ├── pages/            # auth, learner, admin
│   │   ├── lib/              # axios client, query keys
│   │   ├── routes/           # ProtectedRoute
│   │   └── stores/           # Zustand auth store
│   ├── tailwind.config.js    # design tokens — xem docs/DESIGN_SYSTEM.md
│   ├── vercel.json           # rewrite SPA về /index.html
│   └── .env.example          # VITE_API_URL
└── docs/
    ├── ARCHITECTURE.md
    ├── DEPLOY.md
    ├── DESIGN_SYSTEM.md
    └── API.md
```

## Chạy local

### Yêu cầu

- Python 3.12+, Node.js 18+ (khuyến nghị 20/22), npm.
- Không bắt buộc có PostgreSQL local: để trống `DATABASE_URL` thì backend dùng SQLite (`dev.db`).

### 1. Backend (Flask)

```bash
cd backend
cp .env.example .env        # chỉnh SECRET_KEY / JWT_SECRET_KEY khi cần
python3 -m venv .venv
source .venv/bin/activate   # Windows (WSL dùng cùng lệnh này)
pip install -r requirements.txt

flask --app wsgi seed       # tạo bảng (create_all) + admin đầu tiên + khóa mẫu english-a1
flask --app wsgi run --port 5000
```

Chạy bằng Gunicorn (giống production trên Render):

```bash
gunicorn wsgi:app --bind 0.0.0.0:5000 --workers 2 --threads 4
```

Kiểm tra nhanh: `curl http://localhost:5000/health` → trả về trạng thái service + database.

Lưu ý: lệnh `flask` tự nạp file `.env` (nhờ `python-dotenv`). Khi chạy bằng Gunicorn thuần, hãy export biến môi trường hoặc đặt env ở hệ thống — trên Render thì đặt trong dashboard.

### 2. Frontend (React + Vite)

```bash
cd frontend
cp .env.example .env        # VITE_API_URL=http://localhost:5000
npm install
npm run dev                 # http://localhost:5173
```

- `VITE_API_URL` là base URL của API, **không** có `/api` ở cuối và không có dấu `/` cuối. Production đặt là URL Render, ví dụ `https://<ten-service>.onrender.com`.
- Khi dev, Vite cũng đã cấu hình proxy `/api` → `http://localhost:5000` trong `vite.config.js` để dự phòng.
- Sau khi sửa biến `VITE_*` phải khởi động lại `npm run dev` (Vite chỉ đọc env lúc start); trên Vercel phải redeploy.

## Tài khoản demo (từ seed)

| Email | Mật khẩu | Vai trò |
| --- | --- | --- |
| `admin@example.com` | `Admin@12345` (giá trị mặc định — chính là `ADMIN_PASSWORD` trong `backend/.env.example`, đổi qua env trước khi chạy seed) | `ADMIN` |
| `learner@example.com` | `Learner@123` | `LEARNER` |

> Kiểm chứng trước khi demo: bản `backend/app/seed.py` tại thời điểm viết tài liệu này tạo sẵn tài khoản admin + khóa mẫu `english-a1`; tài khoản learner ở trên là tài khoản demo **đã quy định cho seed** — nếu chưa đăng nhập được, kiểm tra seed đã bổ sung user này chưa thay vì tự đặt mật khẩu khác. Hai mật khẩu trên là mật khẩu demo cho môi trường dev, **không** dùng nguyên trạng trên production.

## Tài liệu

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — kiến trúc, mô hình dữ liệu, luồng xử lý, bảo mật.
- [docs/API.md](docs/API.md) — danh sách endpoint theo blueprint + yêu cầu quyền.
- [docs/DEPLOY.md](docs/DEPLOY.md) — triển khai Neon + Render + Vercel từng bước.
- [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) — chuẩn giao diện doanh nghiệp (token, điều cấm, trạng thái component bắt buộc).

## Roadmap

- **MVP (đang làm):** hoàn thiện các page frontend trên nền API đã có; khởi tạo Flask-Migrate (`flask db init`) để quản lý schema thay cho `create_all`; bổ sung seed tài khoản learner; test cơ bản cho auth + submit bài.
- **V1:** ôn tập SRS (câu sai quay lại theo lịch), thêm dạng bài tập (nghe, ghép cặp hoàn chỉnh), trang thống kê admin chi tiết hơn, AI trợ lý quản lý trả lời dựa trên số liệu thật (stats + bài học yếu).
- **V2:** hearts/lives và league theo tuần, badge/thành tích, luyện nói (speech), thông báo nhắc streak, cân nhắc nâng gói Render để hết cold start.

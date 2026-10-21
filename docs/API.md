# API Reference

Base URL:

- Local: `http://localhost:5000`
- Production: URL của Web Service trên Render, ví dụ `https://<ten-service>.onrender.com`

Tài liệu này liệt kê endpoint **đúng với các blueprint hiện có** trong `backend/app/blueprints/`. Endpoint chưa triển khai được ghi riêng ở cuối, không nằm trong các bảng chính.

## Quy ước chung

**Xác thực:** JWT Bearer của Flask-JWT-Extended.

```
Authorization: Bearer <access_token>
```

- Access token: hạn 30 phút, lấy từ `POST /api/auth/login`; làm mới bằng `POST /api/auth/refresh` với refresh token (hạn 7 ngày).
- Cột "Auth" trong các bảng: **Public** = không cần token · **JWT** = cần access token · **JWT (tùy chọn)** = không bắt buộc, có token thì dữ liệu cá nhân hóa hơn · **Refresh JWT** = gửi refresh token thay cho access token · **Manager** = JWT + role `ADMIN` hoặc `TEACHER` · **Admin** = JWT + role `ADMIN`.

**Format response** (`app/utils/responses.py`):

```jsonc
// Thành công
{ "success": true, "data": { /* ... */ } }

// Danh sách có phân trang (kèm meta cùng cấp với data)
{ "success": true, "data": [ /* ... */ ], "total": 42, "page": 1, "per_page": 20 }

// Lỗi
{ "success": false, "error": { "message": "Email hoặc mật khẩu không đúng", "code": 401 } }
```

Mã lỗi thường gặp: `400` dữ liệu không hợp lệ · `401` chưa đăng nhập / sai thông tin đăng nhập / token không hợp lệ · `403` không đủ quyền · `404` không tồn tại · `409` trùng dữ liệu · `429` vượt rate limit.

## Health (blueprint `health`, không prefix)

| Method | Path | Auth | Mô tả |
| --- | --- | --- | --- |
| GET | `/health` | Public | Kiểm tra service + database (`SELECT 1`). Trả `data: { service: "learning-support-api", database: "up" \| "down" }`. |

## Auth (blueprint `auth`, prefix `/api/auth`)

| Method | Path | Auth | Mô tả |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | Public | Đăng ký. Body: `{ email, password, full_name }` — mật khẩu tối thiểu 8 ký tự. Role luôn là `LEARNER`, request không gán được role khác. Trả `201` + thông tin user. Lỗi `409` nếu email đã đăng ký. |
| POST | `/api/auth/login` | Public | Đăng nhập. Body: `{ email, password }`. Trả `{ user, access_token, refresh_token }`. Lỗi `401` nếu sai email/mật khẩu hoặc tài khoản bị khóa. |
| POST | `/api/auth/refresh` | Refresh JWT | Đổi refresh token lấy access token mới. Trả `{ access_token }`. |
| GET | `/api/auth/me` | JWT | Thông tin user hiện tại kèm `current_streak`. |

Ví dụ đăng nhập:

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "Admin@12345"}'
```

## Courses & Progress (blueprint `courses`, prefix `/api`)

> Chưa có blueprint `progress` riêng — các endpoint tiến độ nằm trong blueprint `courses` (và streak xuất hiện thêm ở `/api/auth/me`).

| Method | Path | Auth | Mô tả |
| --- | --- | --- | --- |
| GET | `/api/courses` | Public | Danh sách khóa **đã xuất bản** (`is_published = true`), kèm `total_units`, `total_lessons`. |
| GET | `/api/courses/:course_id/path` | JWT (tùy chọn) | Lộ trình học: units → lessons. Có token thì mỗi lesson có `status` (`COMPLETED`/`AVAILABLE`) và `score` của user; không token thì mọi lesson là `AVAILABLE`. |
| GET | `/api/lessons/:lesson_id` | JWT | Chi tiết bài + danh sách exercise. **Không** trả `correct_answer` và `explanation`. |
| POST | `/api/lessons/:lesson_id/submit` | JWT | Nộp bài — endpoint tiến độ chính. Body: `{ "answers": { "<exercise_id>": "<đáp án>" } }`. Backend chấm, ghi `Attempt`, cập nhật `UserProgress`, cộng XP nếu đạt lần đầu, cập nhật streak. Trả `{ score, passed, correct, total, xp_earned, details[] }`; `passed` khi `score >= 80`; `details` chứa đáp án đúng + giải thích từng câu. |
| GET | `/api/leaderboard` | JWT | Top 20 user đang active theo `xp` giảm dần: `{ id, full_name, xp }`. |

Ví dụ nộp bài:

```bash
curl -X POST http://localhost:5000/api/lessons/1/submit \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"answers": {"1": "Good morning", "2": "name"}}'
```

## Admin (blueprint `admin`, prefix `/api/admin`)

| Method | Path | Auth | Mô tả |
| --- | --- | --- | --- |
| GET | `/api/admin/stats` | Manager | Thống kê: `{ total_learners, total_courses, total_lessons, total_attempts, accuracy_percent }`. |
| GET | `/api/admin/users` | Manager | Danh sách user. Query: `page` (mặc định 1), `per_page` (mặc định 20, tối đa 100), `q` (tìm theo họ tên/email). Trả `data` + `total`, `page`, `per_page`. |
| POST | `/api/admin/courses` | Admin | Tạo khóa. Body: `{ title, slug, description?, level?, is_published? }`. Trả `201`. |
| POST | `/api/admin/courses/:course_id/units` | Admin | Tạo chương cho khóa. Body: `{ title, order_index? }`. Trả `201` `{ id, title }`. |
| GET | `/api/admin/lessons/weakest` | Manager | Danh sách bài học phục vụ phân tích "bài học yếu". **Trạng thái cơ bản:** hiện mới trả `{ lesson_id, title }`, chưa có tỉ lệ đúng/ xếp hạng hoàn chỉnh — frontend không nên hiển thị như số liệu cuối. |

## AI Chat (blueprint `ai`, prefix `/api/ai`)

Tất cả endpoint AI đều cần JWT và bị giới hạn **30 request/giờ** cho mỗi IP (Flask-Limiter). Khi backend chưa có API key AI tương ứng, response là **chế độ stub** và nội dung trả lời có ghi rõ điều đó.

| Method | Path | Auth | Mô tả |
| --- | --- | --- | --- |
| POST | `/api/ai/chat` | JWT | Gửi tin nhắn, nhận trả lời đồng bộ. Body: `{ message, session_id?, context_type?, context_id? }`. Không có `session_id` thì tạo session mới. `context_type`: `LESSON` (mặc định, kèm ngữ cảnh bài học nếu có `context_id`) hoặc `ADMIN` (chỉ role `ADMIN`/`TEACHER`, role khác bị `403`). Trả `{ session_id, reply }`. |
| POST | `/api/ai/chat/stream` | JWT | Như `/chat` nhưng trả **SSE** (`text/event-stream`): nhiều sự kiện `data: {"delta": "..."}`, kết thúc bằng `data: [DONE]`. Lưu ý: server hiện chia câu trả lời hoàn chỉnh thành từng từ để phát dần, chưa stream token trực tiếp từ provider. |
| GET | `/api/ai/sessions` | JWT | 20 session gần nhất của user hiện tại: `{ id, title, context_type, context_id }`. |

Ví dụ chat trong ngữ cảnh bài học:

```bash
curl -X POST http://localhost:5000/api/ai/chat \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Vì sao câu này dùng Good morning?", "context_type": "LESSON", "context_id": 1}'
```

## Endpoint chưa triển khai (frontend đang chờ — đừng gọi như đã có)

| Method | Path | Ghi chú |
| --- | --- | --- |
| PATCH | `/api/admin/users/:id` | Frontend (`AdminUsers`) đã chuẩn bị luồng khóa/mở tài khoản (`{ is_active }`) và đổi vai trò (`{ role }`), backend **chưa có** endpoint này. |

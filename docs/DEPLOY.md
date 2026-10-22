# Deploy: Neon (DB) + Render (Backend) + Vercel (Frontend)

Thứ tự triển khai bắt buộc: **Neon → Render → Vercel → quay lại Render cập nhật CORS**. Lý do: Render cần `DATABASE_URL` của Neon, Vercel cần URL của Render, và Render cần biết domain Vercel để mở CORS.

Trạng thái cần biết trước khi bắt đầu:

- Backend đã có `backend/Dockerfile` (Gunicorn) và chạy được bằng Python runtime của Render.
- Repo **chưa có migration scripts Alembic** (`backend/migrations/` mới có README). Lần deploy đầu, schema được tạo bằng `flask seed` (lệnh này tự `db.create_all()` + tạo admin + khóa mẫu). Mục `flask db upgrade` ở dưới dành cho khi đã `flask db init` và có file migration thật — đừng chạy và tưởng DB đã được migrate nếu bước init chưa làm.
- Render free tier và Neon free tier đều "ngủ" khi rảnh — xem mục lưu ý cold start ở cuối.

---

## 1. Neon — tạo database Postgres

1. Vào [neon.tech](https://neon.tech), đăng nhập, chọn **New Project**.
2. Đặt tên project (ví dụ `learning-support-system`), chọn **Postgres version** mặc định và **Region** gần người dùng nhất (ví dụ Singapore `aws-ap-southeast-1`). Bấm **Create Project**.
3. Neon tạo sẵn database `neondb` và role chủ sở hữu. Vào **Dashboard → Connection Details**.
4. **Bắt buộc chọn bản pooled**: tích/bật tùy chọn **Connection pooling** (hoặc chọn tab pooler). Chuỗi kết nối đúng có host chứa `-pooler`, ví dụ:

   ```
   postgresql://<user>:<password>@ep-<...>-pooler.<region>.aws.neon.tech/neondb?sslmode=require
   ```

5. Copy chuỗi này — đây là giá trị `DATABASE_URL` cho Render ở bước 2.

Ghi chú kỹ thuật (đã xử lý sẵn trong `backend/app/config.py`, không cần sửa tay):

- Tiền tố `postgres://` / `postgresql://` tự được đổi sang driver `postgresql+psycopg://`.
- Host chứa `neon.tech` mà thiếu `sslmode` sẽ tự được thêm `sslmode=require`.
- Engine bật `pool_pre_ping` + `pool_recycle=300` để chịu được việc Neon suspend compute.
- **Không** commit chuỗi kết nối này vào repo, không để trong `.env.example`.

## 2. Render — deploy backend Flask

### 2.1. Tạo Web Service

1. Vào [render.com](https://render.com) → **New + → Web Service** → kết nối repo GitHub `learning-support-system`.
2. Cấu hình:
   - **Name:** ví dụ `learning-support-api` (tên này quyết định URL `https://learning-support-api.onrender.com`).
   - **Root Directory:** `backend` ← quan trọng nhất, rất hay quên.
   - **Region:** chọn cùng khu vực với Neon nếu có (Singapore).
   - **Instance Type:** Free (demo) hoặc Starter khi cần hết cold start.
3. Chọn 1 trong 2 cách chạy:
   - **Docker (khuyến nghị, dùng `backend/Dockerfile` có sẵn):** Runtime = **Docker**. Không cần Build/Start Command — Dockerfile đã chạy: `gunicorn wsgi:app --bind 0.0.0.0:${PORT:-10000} --workers 2 --threads 4 --timeout 120`.
   - **Python runtime:** Build Command: `pip install -r requirements.txt` · Start Command: `gunicorn wsgi:app --bind 0.0.0.0:$PORT --workers 2 --threads 4 --timeout 120`. Đặt env `PYTHON_VERSION=3.12.3` trong dashboard nếu Render chọn bản Python khác.
4. **Health Check Path:** `/health`.

### 2.2. Biến môi trường (Environment → Add Environment Variable)

| Key | Giá trị | Bắt buộc |
| --- | --- | --- |
| `DATABASE_URL` | Pooled connection string từ Neon (bước 1) | Có |
| `SECRET_KEY` | Chuỗi ngẫu nhiên dài (tự sinh, không dùng `change-me`) | Có |
| `JWT_SECRET_KEY` | Chuỗi ngẫu nhiên dài, **khác** `SECRET_KEY` | Có |
| `CORS_ORIGINS` | `http://localhost:5173` lúc đầu; sau khi có domain Vercel thì sửa thành `https://<project>.vercel.app,http://localhost:5173` | Có |
| `ADMIN_EMAIL` | Mặc định `admin@example.com` nếu không đặt | Không |
| `ADMIN_PASSWORD` | Mật khẩu admin đầu tiên — **không** dùng mặc định `Admin@12345` trên production | Nên đặt |
| `AI_PROVIDER` | `gemini` (mặc định) hoặc `openai` | Không |
| `AI_MODEL` | `gemini-3.8-flash` (mặc định) hoặc model OpenAI tương ứng | Không |
| `GEMINI_API_KEY` | Key từ Google AI Studio — nếu dùng Gemini | Theo provider |
| `OPENAI_API_KEY` | Key OpenAI — nếu dùng OpenAI | Theo provider |
| `AI_DAILY_LIMIT` | Mặc định `50`. Lưu ý: biến này hiện mới khai báo trong config, **chưa enforce** trong code; giới hạn đang áp thật là 30 req/giờ cho endpoint AI chat | Không |

Không đặt key AI thì hệ thống vẫn chạy, AI trả lời ở chế độ stub (có ghi rõ trong nội dung trả lời) — hợp cho lần deploy thử đầu tiên.

### 2.3. Tạo schema + dữ liệu mẫu (sau khi service build xong)

Vào **Render Dashboard → service → Shell**:

```bash
# Lần đầu (chưa có migration): tạo bảng + admin + khóa mẫu english-a1 (idempotent, chạy lại an toàn)
flask --app wsgi seed
```

Khi repo đã được khởi tạo migration (trạng thái hiện tại: **chưa**), quy trình chuẩn cho các lần đổi schema về sau là:

```bash
flask --app wsgi db upgrade   # chỉ có tác dụng khi đã có file migration trong backend/migrations/
flask --app wsgi seed
```

### 2.4. Kiểm tra

```bash
curl https://<ten-service>.onrender.com/health
# → {"success": true, "data": {"service": "learning-support-api", "database": "up"}}
```

Nếu `database: "down"`: kiểm tra lại `DATABASE_URL` (đúng bản pooled chưa, đúng project Neon chưa) trong tab Environment rồi **Manual Deploy → Deploy latest commit** để service nạp lại env.

## 3. Vercel — deploy frontend React

1. Vào [vercel.com](https://vercel.com) → **Add New… → Project** → import cùng repo GitHub.
2. Cấu hình ở màn hình cấu hình project:
   - **Root Directory:** `frontend` ← quan trọng nhất.
   - **Framework Preset:** Vite (Vercel thường tự nhận diện).
   - **Build Command:** `npm run build` · **Output Directory:** `dist` (mặc định của Vite, không cần sửa).
3. **Environment Variables** (Project Settings → Environment Variables, áp cho Production):

   | Key | Giá trị |
   | --- | --- |
   | `VITE_API_URL` | `https://<ten-service>.onrender.com` — không có `/api` ở cuối, không có dấu `/` cuối |

4. Bấm **Deploy**. Sau khi có domain `https://<project>.vercel.app`, quay lại **Render → Environment**, sửa `CORS_ORIGINS` thêm domain này (xem 2.2) và redeploy Render.
5. SPA routing đã có sẵn `frontend/vercel.json`:

   ```json
   { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
   ```

   Nhờ đó refresh trang ở route con (ví dụ `/admin/users`) không bị 404. Không xóa file này.

Lưu ý: biến `VITE_*` được nhúng vào bundle lúc build. Sửa `VITE_API_URL` xong **phải redeploy Vercel** (Deployments → … → Redeploy) mới có tác dụng.

## 4. CORS — cách hệ thống đang mở

- Backend chỉ áp CORS cho `/api/*` (`create_app()` trong `backend/app/__init__.py`), origin đọc từ env `CORS_ORIGINS` (nhiều origin cách nhau bằng dấu phẩy), `supports_credentials=True`.
- Lỗi CORS điển hình: FE chạy được ở localhost nhưng lên Vercel bị chặn → gần như chắc chắn là chưa thêm domain Vercel vào `CORS_ORIGINS` trên Render, hoặc thêm sai (thừa `/` cuối, thiếu `https://`).
- Sau mỗi lần sửa `CORS_ORIGINS` phải redeploy/restart service Render.

## 5. Cold start — giới hạn của gói free (biết trước để khỏi tưởng lỗi)

- **Render free:** service ngủ sau khoảng 15 phút không có request. Request đầu tiên sau khi ngủ phải chờ service khởi động lại (thường vài chục giây, có thể tới ~1 phút với Gunicorn + Flask). Health check và các request sau đó nhanh bình thường. Bản demo/bảo vệ: mở sẵn trang và gọi `/health` trước vài phút, hoặc nâng lên gói Starter để service không ngủ.
- **Neon free:** compute tự suspend khi idle; query đầu tiên sau khi suspend có độ trễ "đánh thức" vài giây. Code đã có `pool_pre_ping` + `pool_recycle` để tự loại kết nối chết, nên triệu chứng chỉ là **chậm ở request đầu**, không phải lỗi kết nối — đừng vội sửa code khi thấy hiện tượng này.
- Hai độ trễ trên cộng dồn: lần mở đầu tiên sau thời gian dài không dùng có thể chậm rõ rệt, các lần sau trong phiên làm việc thì bình thường.

## 6. Checklist go-live

- [ ] Neon: đã lấy **pooled** connection string (host có `-pooler`).
- [ ] Render: Root Directory = `backend`, Health Check Path = `/health`.
- [ ] Render env: `DATABASE_URL`, `SECRET_KEY`, `JWT_SECRET_KEY` (2 secret khác nhau, không dùng giá trị mẫu), `ADMIN_PASSWORD` đã đổi.
- [ ] Đã chạy `flask --app wsgi seed` trong Render Shell, `/health` trả `database: "up"`.
- [ ] Vercel: Root Directory = `frontend`, `VITE_API_URL` trỏ đúng Render, đã redeploy sau khi đặt env.
- [ ] Render `CORS_ORIGINS` chứa domain Vercel, đã redeploy Render sau khi sửa.
- [ ] Đăng nhập được bằng tài khoản admin đã seed trên bản production và đổi mật khẩu demo nếu dùng lâu dài.

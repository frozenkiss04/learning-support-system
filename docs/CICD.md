# CI/CD

## Pipeline

```
push / PR vào main
  └─ CI (.github/workflows/ci.yml)
       ├─ Backend: pip install + compileall + pytest (SQLite, AI stub — 63 test)
       └─ Frontend: npm ci + npm run build
  └─ CD (.github/workflows/deploy.yml) — chỉ chạy khi CI xanh, hoặc bấm tay ở tab Actions
       ├─ Backend → Render: POST Deploy Hook (secret RENDER_DEPLOY_HOOK_URL)
       └─ Frontend → Vercel: Vercel CLI deploy --prod (secrets VERCEL_*)
```

Neon không cần bước deploy trong pipeline: nó là Postgres serverless, backend nối vào qua
`DATABASE_URL` (env trên Render). Schema lần đầu tạo bằng `flask seed` (xem DEPLOY.md).

## Secrets cần đặt (GitHub → Settings → Secrets and variables → Actions)

| Secret | Lấy ở đâu | Bắt buộc cho |
|---|---|---|
| `RENDER_DEPLOY_HOOK_URL` | Render Dashboard → service `learning-support-api` → Settings → Deploy Hook | CD backend |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens | CD frontend |
| `VERCEL_ORG_ID` | Vercel → project Settings → General (hoặc file `.vercel/project.json` sau `vercel link`) | CD frontend |
| `VERCEL_PROJECT_ID` | Như trên | CD frontend |

Chưa có secret thì job CD tương ứng chỉ in thông báo hướng dẫn và kết thúc xanh —
không báo fail, không deploy nhầm.

## Thứ tự kết nối 3 nền tảng lần đầu

1. **Neon** — tạo project → lấy **pooled** connection string (host có `-pooler`).
2. **Render** — New → Blueprint → chọn repo này (dùng `render.yaml` sẵn) → điền các env
   `sync: false`: `DATABASE_URL` (chuỗi Neon), `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
   `GEMINI_API_KEY`; `CORS_ORIGINS` tạm để trống/sau cập nhật ở bước 4.
   Sau deploy đầu, mở Shell của service chạy `flask seed` để tạo bảng + dữ liệu mẫu.
   Lấy URL dạng `https://learning-support-api.onrender.com`, kiểm tra `/health`.
3. **Vercel** — Import repo → Root Directory = `frontend` → env `VITE_API_URL` = URL Render
   ở bước 2 → Deploy. Lấy domain dạng `https://<project>.vercel.app`.
4. **Quay lại Render** — set `CORS_ORIGINS` = domain Vercel ở bước 3 → redeploy
   (hoặc chờ CD). Kiểm tra đăng nhập thật trên bản production.
5. **Bật CD tự động** — thêm 4 secrets ở bảng trên vào GitHub. Từ đây mỗi lần push `main`
   mà CI xanh, cả FE lẫn BE tự deploy.

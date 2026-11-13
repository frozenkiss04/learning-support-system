# Migrations

Alembic env đã được khởi tạo (`flask db init`) + migration đầu tiên khớp
toàn bộ schema hiện tại. Quy trình:

- Đổi schema ở máy dev: sửa model rồi chạy `flask db migrate -m "<mô tả>"`,
  kiểm tra file sinh ra trong `versions/`, rồi commit.
- Deploy: `flask db upgrade` chạy trước `flask seed` (đã có trong
  `render.yaml` startCommand và `backend/Dockerfile`).
- Local lần đầu vẫn có thể chỉ chạy `flask seed` (tự `db.create_all()`),
  nhưng DB đó sẽ chưa có dòng `alembic_version` — chạy thêm
  `flask db stamp head` nếu muốn Alembic coi nó là mới nhất, hoặc xóa
  file SQLite rồi chạy `flask db upgrade && flask seed`.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Lock,
  LockOpen,
  Search,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import api from "../../lib/api";

/**
 * Quản lý học viên (admin).
 *
 * API:
 * - GET   /api/admin/users?page=&per_page=&q=   -> { data: User[], total, page, per_page }
 * - PATCH /api/admin/users/:id                  -> { is_active } để khóa/mở, { role } để đổi vai trò
 *   LƯU Ý: endpoint PATCH hiện CHƯA có ở backend (blueprints/admin.py mới có GET).
 *   FE gọi đúng contract này; khi BE bổ sung PATCH thì trang hoạt động ngay,
 *   hiện tại thao tác sẽ trả lỗi và UI hiển thị thông báo lỗi từ server.
 *
 * User: { id, email, full_name, role: LEARNER|TEACHER|ADMIN, xp, is_active, created_at }
 */

const PER_PAGE = 20;
const ROLES = ["LEARNER", "TEACHER", "ADMIN"];

const ROLE_LABEL = { LEARNER: "Học viên", TEACHER: "Giáo viên", ADMIN: "Quản trị viên" };
const ROLE_BADGE = {
  LEARNER: "border-green-200 bg-green-50 text-green-800",
  TEACHER: "border-slate-300 bg-white text-slate-700",
  ADMIN: "border-slate-900 bg-slate-900 text-white",
};

function normalizeListResponse(res) {
  // api.js đã unwrap trường `data`; tuỳ interceptor, meta phân trang có thể
  // nằm cùng cấp với data ({ data, total, page }) hoặc bị mất — xử lý cả hai.
  if (Array.isArray(res)) {
    return { items: res, total: res.total ?? res.length, page: res.page ?? 1 };
  }
  const items = res?.data ?? res?.items ?? [];
  return {
    items: Array.isArray(items) ? items : [],
    total: res?.total ?? res?.meta?.total ?? (Array.isArray(items) ? items.length : 0),
    page: res?.page ?? 1,
  };
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename, headers, rows) {
  const lines = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ];
  // BOM ở đầu file để Excel đọc đúng tiếng Việt (UTF-8).
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function initials(name = "") {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

function ConfirmDialog({ title, description, confirmLabel, onCancel, onConfirm, busy }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-lg">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Đóng"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="px-5 py-4 text-sm leading-6 text-slate-600">{description}</p>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [pendingLock, setPendingLock] = useState(null); // user sắp bị khóa, chờ xác nhận
  const debounceRef = useRef(null);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/api/admin/users", {
        params: { page, per_page: PER_PAGE, q: debouncedQuery || undefined },
      });
      const { items, total: t } = normalizeListResponse(res);
      setUsers(items);
      setTotal(t);
    } catch (err) {
      setError(err?.response?.data?.error?.message || "Không tải được danh sách học viên.");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedQuery]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Search debounce 400ms, gõ mới thì quay về trang 1.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setDebouncedQuery(query.trim());
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const patchUser = useCallback(async (user, patch, successMessage) => {
    setBusyId(user.id);
    setError("");
    setNotice("");
    try {
      // Contract: PATCH /api/admin/users/:id { is_active } | { role } (BE chưa triển khai).
      const res = await api.patch(`/api/admin/users/${user.id}`, patch);
      const updated = res && !Array.isArray(res) && res.id ? res : { ...user, ...patch };
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...updated } : u)));
      setNotice(successMessage);
    } catch (err) {
      setError(
        err?.response?.data?.error?.message ||
          "Thao tác chưa thực hiện được. Kiểm tra lại quyền hoặc endpoint PATCH /api/admin/users/:id ở backend."
      );
    } finally {
      setBusyId(null);
    }
  }, []);

  const handleToggleActive = (user) => {
    if (user.is_active) {
      setPendingLock(user); // khóa tài khoản phải xác nhận trước
    } else {
      patchUser(user, { is_active: true }, `Đã mở lại tài khoản ${user.email}.`);
    }
  };

  const confirmLock = async () => {
    if (!pendingLock) return;
    await patchUser(
      pendingLock,
      { is_active: false },
      `Đã khóa tài khoản ${pendingLock.email}.`
    );
    setPendingLock(null);
  };

  const handleRoleChange = (user, role) => {
    if (role === user.role) return;
    patchUser(user, { role }, `Đã đổi vai trò của ${user.email} thành ${ROLE_LABEL[role]}.`);
  };

  // Xuất CSV đúng dữ liệu đang có trong state (trang hiện tại, đã lọc theo từ khóa).
  const handleExportCsv = () => {
    const headers = ["id", "full_name", "email", "role", "xp", "is_active", "created_at"];
    const rows = users.map((u) => [
      u.id,
      u.full_name ?? "",
      u.email ?? "",
      u.role ?? "",
      u.xp ?? 0,
      u.is_active ? "true" : "false",
      u.created_at ?? "",
    ]);
    downloadCsv("users.csv", headers, rows);
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Học viên</h1>
          <p className="mt-1 text-sm text-slate-500">
            Danh sách tài khoản trong hệ thống. Tổng {total} tài khoản.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={users.length === 0}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Xuất CSV
        </button>
      </div>

      {/* Toolbar */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo họ tên hoặc email..."
            className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-green-700 focus:ring-1 focus:ring-green-700"
          />
        </div>
        {loading && (
          <span className="inline-flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải...
          </span>
        )}
      </div>

      {/* Thông báo */}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800">
          {notice}
        </div>
      )}

      {/* Bảng học viên */}
      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Học viên</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Vai trò</th>
                <th className="px-4 py-3 text-right font-medium">XP</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-4 py-3 font-medium">Ngày tạo</th>
                <th className="px-4 py-3 text-right font-medium">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <Users className="mx-auto h-6 w-6 text-slate-300" />
                    <p className="mt-2 text-sm text-slate-500">
                      {debouncedQuery
                        ? "Không có tài khoản nào khớp với từ khóa tìm kiếm."
                        : "Chưa có tài khoản nào trong hệ thống."}
                    </p>
                  </td>
                </tr>
              )}
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                        {initials(user.full_name)}
                      </span>
                      <span className="font-medium text-slate-900">{user.full_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[user.role] ?? ROLE_BADGE.LEARNER}`}
                    >
                      {ROLE_LABEL[user.role] ?? user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900">
                    {(user.xp ?? 0).toLocaleString("vi-VN")}
                  </td>
                  <td className="px-4 py-3">
                    {user.is_active ? (
                      <span className="inline-flex items-center gap-1.5 text-slate-700">
                        <span className="h-2 w-2 rounded-full bg-green-600" />
                        Đang hoạt động
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-slate-500">
                        <span className="h-2 w-2 rounded-full bg-slate-300" />
                        Đã khóa
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(user.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <select
                        value={user.role}
                        disabled={busyId === user.id}
                        onChange={(e) => handleRoleChange(user, e.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-green-700 disabled:opacity-50"
                        aria-label={`Đổi vai trò của ${user.email}`}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busyId === user.id}
                        onClick={() => handleToggleActive(user)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {busyId === user.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : user.is_active ? (
                          <Lock className="h-4 w-4" />
                        ) : (
                          <LockOpen className="h-4 w-4" />
                        )}
                        {user.is_active ? "Khóa" : "Mở khóa"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Phân trang */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <p className="text-sm text-slate-500">
            Trang {page} / {totalPages} — hiển thị {users.length} trong {total} tài khoản
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" /> Trước
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Sau <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {pendingLock && (
        <ConfirmDialog
          title="Khóa tài khoản"
          description={`Khóa tài khoản ${pendingLock.full_name} (${pendingLock.email})? Học viên sẽ không đăng nhập được cho đến khi tài khoản được mở lại. Dữ liệu học tập vẫn được giữ nguyên.`}
          confirmLabel="Khóa tài khoản"
          busy={busyId === pendingLock.id}
          onCancel={() => setPendingLock(null)}
          onConfirm={confirmLock}
        />
      )}
    </div>
  );
}

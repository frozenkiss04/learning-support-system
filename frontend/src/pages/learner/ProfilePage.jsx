import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Flame,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  ShieldCheck,
  User,
  Zap,
} from "lucide-react";
import api from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

const ROLE_LABELS = {
  LEARNER: "Học viên",
  TEACHER: "Giáo viên",
  ADMIN: "Quản trị viên",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function initialsOf(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * Hồ sơ cá nhân.
 * API: GET  /api/auth/me
 *      POST /api/auth/change-password { current_password, new_password }
 */
export default function ProfilePage() {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const setUser = useAuthStore((state) => state.setUser);

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [form, setForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api.get("/api/auth/me");
      setProfile(data);
      if (typeof setUser === "function") setUser(data);
    } catch (err) {
      setLoadError(
        err?.response?.data?.error?.message ||
          "Không tải được thông tin tài khoản. Vui lòng thử lại."
      );
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleFormChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setFormErrors((prev) => ({ ...prev, [name]: undefined }));
    setSubmitError("");
    setSubmitSuccess("");
  };

  const validateForm = () => {
    const errors = {};
    if (!form.current_password) {
      errors.current_password = "Vui lòng nhập mật khẩu hiện tại.";
    }
    if (!form.new_password) {
      errors.new_password = "Vui lòng nhập mật khẩu mới.";
    } else if (form.new_password.length < 8) {
      errors.new_password = "Mật khẩu mới phải có tối thiểu 8 ký tự.";
    } else if (form.new_password === form.current_password) {
      errors.new_password = "Mật khẩu mới phải khác mật khẩu hiện tại.";
    }
    if (!form.confirm_password) {
      errors.confirm_password = "Vui lòng nhập lại mật khẩu mới.";
    } else if (form.confirm_password !== form.new_password) {
      errors.confirm_password = "Mật khẩu nhập lại không khớp.";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    setSubmitError("");
    setSubmitSuccess("");
    if (!validateForm()) return;
    setSubmitting(true);
    try {
      await api.post("/api/auth/change-password", {
        current_password: form.current_password,
        new_password: form.new_password,
      });
      setForm({ current_password: "", new_password: "", confirm_password: "" });
      setSubmitSuccess("Đổi mật khẩu thành công.");
    } catch (err) {
      setSubmitError(
        err?.response?.data?.error?.message ||
          err?.message ||
          "Đổi mật khẩu thất bại. Vui lòng kiểm tra lại mật khẩu hiện tại."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      if (typeof logout === "function") await logout();
    } finally {
      navigate("/login", { replace: true });
    }
  };

  const inputClass = (hasError) =>
    `w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-1 ${
      hasError
        ? "border-red-300 focus:border-red-400"
        : "border-slate-300 focus:border-green-700"
    }`;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header trang */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Hồ sơ cá nhân</h1>
        <p className="mt-1 text-sm text-slate-600">
          Thông tin tài khoản, tiến độ học tập và bảo mật.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Đang tải hồ sơ...
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center rounded-lg border border-slate-200 bg-white px-6 py-16 text-center">
          <AlertCircle className="h-8 w-8 text-red-500" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-slate-900">
            Đã xảy ra lỗi
          </p>
          <p className="mt-1 max-w-sm text-sm text-slate-600">{loadError}</p>
          <button
            type="button"
            onClick={loadProfile}
            className="mt-4 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
          >
            Thử lại
          </button>
        </div>
      ) : !profile ? (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-600">
          Không có dữ liệu tài khoản để hiển thị.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Thông tin tài khoản */}
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="text-sm font-semibold text-slate-900">
                Thông tin tài khoản
              </h2>
            </div>
            <div className="px-6 py-5">
              <div className="flex flex-wrap items-center gap-4">
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-base font-semibold text-slate-700"
                  aria-hidden="true"
                >
                  {initialsOf(profile.full_name)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-slate-900">
                    {profile.full_name}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-600">
                    <Mail className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    {profile.email}
                  </p>
                </div>
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                  <ShieldCheck
                    className="h-3.5 w-3.5 text-green-700"
                    aria-hidden="true"
                  />
                  {ROLE_LABELS[profile.role] || profile.role}
                </span>
              </div>

              <dl className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
                <div>
                  <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                    <User className="h-3.5 w-3.5" aria-hidden="true" />
                    Họ và tên
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">
                    {profile.full_name}
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                    Ngày tham gia
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">
                    {formatDate(profile.created_at)}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          {/* Thống kê học tập */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white px-6 py-5">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                <Zap className="h-4 w-4 text-green-700" aria-hidden="true" />
                Tổng điểm XP
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                {Number(profile.xp || 0).toLocaleString("vi-VN")}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Điểm kinh nghiệm tích lũy từ các bài học đã hoàn thành.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-6 py-5">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                <Flame className="h-4 w-4 text-orange-600" aria-hidden="true" />
                Chuỗi ngày học
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                {Number(profile.current_streak || 0).toLocaleString("vi-VN")}{" "}
                <span className="text-sm font-medium text-slate-500">ngày</span>
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Số ngày học liên tiếp hiện tại của bạn.
              </p>
            </div>
          </section>

          {/* Đổi mật khẩu */}
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <KeyRound className="h-4 w-4 text-slate-500" aria-hidden="true" />
                Đổi mật khẩu
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Mật khẩu mới phải có tối thiểu 8 ký tự và khác mật khẩu hiện tại.
              </p>
            </div>
            <form onSubmit={handleChangePassword} className="px-6 py-5" noValidate>
              {submitSuccess && (
                <div className="mb-4 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{submitSuccess}</span>
                </div>
              )}
              {submitError && (
                <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:max-w-md">
                <div>
                  <label
                    htmlFor="current_password"
                    className="mb-1.5 block text-sm font-medium text-slate-700"
                  >
                    Mật khẩu hiện tại
                  </label>
                  <input
                    id="current_password"
                    name="current_password"
                    type="password"
                    autoComplete="current-password"
                    value={form.current_password}
                    onChange={handleFormChange}
                    className={inputClass(formErrors.current_password)}
                    placeholder="Nhập mật khẩu hiện tại"
                  />
                  {formErrors.current_password && (
                    <p className="mt-1.5 text-sm text-red-600">
                      {formErrors.current_password}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="new_password"
                    className="mb-1.5 block text-sm font-medium text-slate-700"
                  >
                    Mật khẩu mới
                  </label>
                  <input
                    id="new_password"
                    name="new_password"
                    type="password"
                    autoComplete="new-password"
                    value={form.new_password}
                    onChange={handleFormChange}
                    className={inputClass(formErrors.new_password)}
                    placeholder="Tối thiểu 8 ký tự"
                  />
                  {formErrors.new_password && (
                    <p className="mt-1.5 text-sm text-red-600">
                      {formErrors.new_password}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="confirm_password"
                    className="mb-1.5 block text-sm font-medium text-slate-700"
                  >
                    Nhập lại mật khẩu mới
                  </label>
                  <input
                    id="confirm_password"
                    name="confirm_password"
                    type="password"
                    autoComplete="new-password"
                    value={form.confirm_password}
                    onChange={handleFormChange}
                    className={inputClass(formErrors.confirm_password)}
                    placeholder="Nhập lại mật khẩu mới"
                  />
                  {formErrors.confirm_password && (
                    <p className="mt-1.5 text-sm text-red-600">
                      {formErrors.confirm_password}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  {submitting ? "Đang xử lý..." : "Đổi mật khẩu"}
                </button>
              </div>
            </form>
          </section>

          {/* Đăng xuất */}
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-6 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Phiên đăng nhập</h2>
              <p className="mt-0.5 text-sm text-slate-600">
                Đăng xuất khỏi tài khoản trên thiết bị này.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 hover:border-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Đăng xuất
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

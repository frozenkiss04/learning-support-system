import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  Award,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Flame,
  GraduationCap,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Printer,
  ScrollText,
  ShieldCheck,
  Sprout,
  User,
  Zap,
} from "lucide-react";
import { apiGet, apiPost } from "../../lib/api";
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

/** Chuỗi ngày local "YYYY-MM-DD" (không dùng toISOString để tránh lệch UTC). */
function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function heatCellClass(count) {
  if (!count) return "bg-slate-100";
  if (count === 1) return "bg-green-200";
  if (count <= 3) return "bg-green-400";
  return "bg-[#15803d]";
}

/**
 * Dựng lưới heatmap 12 tuần x 7 ngày, kết thúc hôm nay.
 * Hàng = thứ trong tuần (0 = Thứ 2 ... 6 = Chủ nhật), cột = tuần.
 * Ô thuộc tương lai được đánh dấu isFuture để render trong suốt.
 */
function buildHeatmapWeeks(activity) {
  const countByDate = new Map();
  for (const item of activity?.days ?? []) {
    if (item?.date) countByDate.set(item.date, Number(item.count) || 0);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIndex = (today.getDay() + 6) % 7; // Thứ 2 = 0
  const start = new Date(today);
  start.setDate(today.getDate() - (11 * 7 + todayIndex));

  const weeks = [];
  for (let w = 0; w < 12; w += 1) {
    const column = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      const dateStr = toLocalDateString(date);
      column.push({
        dateStr,
        count: countByDate.get(dateStr) ?? 0,
        isFuture: date > today,
        label: `${String(date.getDate()).padStart(2, "0")}/${String(
          date.getMonth() + 1
        ).padStart(2, "0")}`,
      });
    }
    weeks.push(column);
  }
  return weeks;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Mở cửa sổ in chứng chỉ với HTML tự chứa (không phụ thuộc tài nguyên ngoài). */
function openCertificatePrint({ courseTitle, learnerName, dateText }) {
  const win = window.open("", "_blank", "width=900,height=640");
  if (!win) return;
  const safeCourse = escapeHtml(courseTitle);
  const safeName = escapeHtml(learnerName);
  const safeDate = escapeHtml(dateText);
  win.document.write(`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>Chứng chỉ hoàn thành — ${safeCourse}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; background: #f1f5f9; padding: 32px; }
  .cert { background: #ffffff; max-width: 820px; margin: 0 auto; border: 3px solid #15803d; padding: 10px; }
  .inner { border: 1px solid #15803d; padding: 48px 56px; text-align: center; }
  .brand { font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: 700; letter-spacing: 4px; color: #15803d; text-transform: uppercase; }
  .brand-sub { font-family: Arial, Helvetica, sans-serif; font-size: 11px; letter-spacing: 2px; color: #64748b; margin-top: 4px; text-transform: uppercase; }
  h1 { font-size: 34px; letter-spacing: 3px; color: #0f172a; margin-top: 36px; text-transform: uppercase; }
  .rule { width: 120px; height: 2px; background: #15803d; margin: 20px auto; }
  .lead { font-size: 15px; color: #475569; font-style: italic; }
  .name { font-size: 32px; font-weight: 700; color: #0f172a; margin-top: 14px; }
  .course { font-size: 22px; font-weight: 700; color: #15803d; margin-top: 10px; }
  .date { font-size: 14px; color: #475569; margin-top: 28px; }
  .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 48px; }
  .footer .cell { width: 220px; text-align: center; }
  .sign { font-family: "Segoe Script", "Brush Script MT", cursive; font-size: 26px; color: #0f172a; }
  .sign-line { border-top: 1px solid #94a3b8; margin-top: 6px; padding-top: 6px; font-family: Arial, Helvetica, sans-serif; font-size: 11px; letter-spacing: 1px; color: #64748b; text-transform: uppercase; }
  .seal { width: 84px; height: 84px; border: 2px solid #15803d; border-radius: 50%; margin: 0 auto; display: flex; align-items: center; justify-content: center; color: #15803d; font-family: Arial, Helvetica, sans-serif; font-weight: 700; font-size: 11px; letter-spacing: 1px; }
  @media print { body { background: #ffffff; padding: 0; } .cert { border-width: 3px; } }
</style>
</head>
<body>
  <div class="cert">
    <div class="inner">
      <div class="brand">LearnHub</div>
      <div class="brand-sub">Hệ thống hỗ trợ học tập trực tuyến</div>
      <h1>Chứng chỉ hoàn thành</h1>
      <div class="rule"></div>
      <p class="lead">Chứng nhận học viên</p>
      <p class="name">${safeName}</p>
      <p class="lead" style="margin-top: 18px;">đã hoàn thành toàn bộ chương trình của khóa học</p>
      <p class="course">${safeCourse}</p>
      <p class="date">Ngày cấp: ${safeDate}</p>
      <div class="footer">
        <div class="cell"><div class="seal">LearnHub</div></div>
        <div class="cell">
          <div class="sign">LearnHub</div>
          <div class="sign-line">Ban quản trị LearnHub</div>
        </div>
      </div>
    </div>
  </div>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`);
  win.document.close();
  win.focus();
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
  const [summary, setSummary] = useState(null);
  const [activity, setActivity] = useState(null);
  const [courseProgress, setCourseProgress] = useState(null);
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
      const data = await apiGet("/api/auth/me");
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

  // Số liệu cho huy hiệu: GET /api/progress/summary (xp, current_streak,
  // longest_streak, completed_lessons). Lỗi thì bỏ qua, huy hiệu dùng số
  // liệu sẵn có trong profile.
  const loadSummary = useCallback(async () => {
    try {
      const data = await apiGet("/api/progress/summary");
      setSummary(data);
    } catch {
      setSummary(null);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Heatmap hoạt động: GET /api/progress/activity?days=84.
  // Lỗi tải thì giữ null để ẩn hẳn mục (không làm vỡ trang).
  const loadActivity = useCallback(async () => {
    try {
      const data = await apiGet("/api/progress/activity?days=84");
      setActivity(data);
    } catch {
      setActivity(null);
    }
  }, []);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  // Tiến độ từng khóa cho mục chứng chỉ: GET /api/courses rồi
  // GET /api/courses/:id/path để đếm bài COMPLETED trên tổng số bài.
  const loadCourseProgress = useCallback(async () => {
    try {
      const courses = await apiGet("/api/courses");
      const list = Array.isArray(courses) ? courses : courses?.courses ?? [];
      const results = await Promise.allSettled(
        list.map((course) => apiGet(`/api/courses/${course.id}/path`))
      );
      const progress = list.map((course, index) => {
        const settled = results[index];
        const units =
          settled.status === "fulfilled" ? settled.value?.units ?? [] : [];
        const lessons = units.flatMap((unit) => unit.lessons ?? []);
        const completedLessons = lessons.filter(
          (lesson) => lesson.status === "COMPLETED"
        );
        // Ngày hoàn thành: lấy completed_at muộn nhất nếu API có trả,
        // không có thì để null (hiển thị ngày hôm nay khi cấp chứng chỉ).
        const completedDates = completedLessons
          .map((lesson) => lesson.completed_at)
          .filter(Boolean)
          .sort();
        return {
          id: course.id,
          title: course.title || "Khóa học",
          total: lessons.length,
          completed: completedLessons.length,
          completedAt: completedDates.length
            ? completedDates[completedDates.length - 1]
            : null,
        };
      });
      setCourseProgress(progress);
    } catch {
      setCourseProgress(null);
    }
  }, []);

  useEffect(() => {
    loadCourseProgress();
  }, [loadCourseProgress]);

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
      await apiPost("/api/auth/change-password", {
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

  // Huy hiệu thành tích: ưu tiên số liệu từ /api/progress/summary,
  // thiếu thì dùng số liệu trong profile (xp, current_streak).
  const badgeXp = Number(summary?.xp ?? profile?.xp ?? 0);
  const badgeCurrentStreak = Number(
    summary?.current_streak ?? profile?.current_streak ?? 0
  );
  const badgeBestStreak = Math.max(
    Number(summary?.longest_streak ?? 0),
    badgeCurrentStreak
  );
  const badgeCompleted = Number(summary?.completed_lessons ?? 0);
  const badges = [
    {
      key: "khoi-dau",
      name: "Khởi đầu",
      condition: "Hoàn thành bài học đầu tiên",
      icon: Sprout,
      achieved: badgeCompleted >= 1,
    },
    {
      key: "chuyen-can",
      name: "Chuyên cần",
      condition: "Đạt chuỗi 3 ngày học liên tiếp",
      icon: CalendarCheck,
      achieved: badgeBestStreak >= 3,
    },
    {
      key: "lua-hoc-tap",
      name: "Lửa học tập",
      condition: "Đạt chuỗi 7 ngày học liên tiếp",
      icon: Flame,
      achieved: badgeBestStreak >= 7,
    },
    {
      key: "hoc-gia",
      name: "Học giả",
      condition: "Hoàn thành 10 bài học",
      icon: GraduationCap,
      achieved: badgeCompleted >= 10,
    },
    {
      key: "tich-luy",
      name: "Tích lũy",
      condition: "Đạt 100 XP",
      icon: Zap,
      achieved: badgeXp >= 100,
    },
    {
      key: "dai-su-tri-thuc",
      name: "Đại sứ tri thức",
      condition: "Đạt 500 XP",
      icon: Award,
      achieved: badgeXp >= 500,
    },
  ];
  const achievedCount = badges.filter((badge) => badge.achieved).length;

  // Heatmap hoạt động học tập (12 tuần gần nhất, kết thúc hôm nay).
  const heatmapWeeks = activity ? buildHeatmapWeeks(activity) : null;
  const activityActiveDays = activity
    ? Number(
        activity.total_active_days ??
          (activity.days ?? []).filter((d) => (Number(d.count) || 0) > 0)
            .length
      )
    : 0;
  const activityTotalActions = activity
    ? Number(
        activity.total_actions ??
          (activity.days ?? []).reduce(
            (sum, d) => sum + (Number(d.count) || 0),
            0
          )
      )
    : 0;

  // Chứng chỉ: khóa học hoàn thành khi mọi bài trong path đều COMPLETED.
  const certificates = (courseProgress ?? []).filter(
    (course) => course.total > 0 && course.completed === course.total
  );
  const nearestCourse =
    (courseProgress ?? [])
      .filter((course) => course.total > 0 && course.completed < course.total)
      .sort((a, b) => b.completed / b.total - a.completed / a.total)[0] ?? null;

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

          {/* Hoạt động học tập (heatmap 12 tuần) */}
          {heatmapWeeks && (
            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-6 py-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Activity
                    className="h-4 w-4 text-slate-500"
                    aria-hidden="true"
                  />
                  Hoạt động học tập
                </h2>
                <span className="text-xs font-medium text-slate-500">
                  {activityActiveDays.toLocaleString("vi-VN")} ngày đã học ·{" "}
                  {activityTotalActions.toLocaleString("vi-VN")} lượt học trong
                  12 tuần
                </span>
              </div>
              <div className="px-6 py-5">
                <div className="flex gap-[3px]" role="img" aria-label="Bản đồ nhiệt hoạt động học tập 12 tuần gần nhất">
                  {/* Nhãn thứ: T2 / T4 / T6 / CN */}
                  <div className="mr-1 flex flex-col gap-[3px]">
                    {["T2", "", "T4", "", "T6", "", "CN"].map((label, i) => (
                      <span
                        key={i}
                        className="flex h-3 items-center text-[9px] leading-none text-slate-400"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  {heatmapWeeks.map((week, weekIndex) => (
                    <div key={weekIndex} className="flex flex-col gap-[3px]">
                      {week.map((cell) =>
                        cell.isFuture ? (
                          <span
                            key={cell.dateStr}
                            className="h-3 w-3 rounded-[2px] bg-transparent"
                          />
                        ) : (
                          <span
                            key={cell.dateStr}
                            title={`${cell.label}: ${cell.count} lượt học`}
                            className={`h-3 w-3 rounded-[2px] ${heatCellClass(
                              cell.count
                            )}`}
                          />
                        )
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                  <span>Ít</span>
                  <span className="h-3 w-3 rounded-[2px] bg-slate-100" />
                  <span className="h-3 w-3 rounded-[2px] bg-green-200" />
                  <span className="h-3 w-3 rounded-[2px] bg-green-400" />
                  <span className="h-3 w-3 rounded-[2px] bg-[#15803d]" />
                  <span>Nhiều</span>
                </div>
              </div>
            </section>
          )}

          {/* Huy hiệu thành tích */}
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Award className="h-4 w-4 text-slate-500" aria-hidden="true" />
                Huy hiệu thành tích
              </h2>
              <span className="text-xs font-medium text-slate-500">
                Đã đạt {achievedCount}/{badges.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 px-6 py-5 sm:grid-cols-3">
              {badges.map((badge) => {
                const BadgeIcon = badge.icon;
                return (
                  <div
                    key={badge.key}
                    className={
                      badge.achieved
                        ? "rounded-lg border border-primary-200 bg-primary-50 px-4 py-4"
                        : "rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 opacity-60"
                    }
                  >
                    <div
                      className={
                        badge.achieved
                          ? "flex h-10 w-10 items-center justify-center rounded-lg border border-primary-200 bg-white text-primary-700"
                          : "flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400"
                      }
                      aria-hidden="true"
                    >
                      <BadgeIcon className="h-5 w-5" />
                    </div>
                    <p
                      className={
                        badge.achieved
                          ? "mt-3 text-sm font-semibold text-slate-900"
                          : "mt-3 text-sm font-semibold text-slate-500"
                      }
                    >
                      {badge.name}
                    </p>
                    <p
                      className={
                        badge.achieved
                          ? "mt-0.5 text-xs font-medium text-primary-700"
                          : "mt-0.5 text-xs text-slate-500"
                      }
                    >
                      {badge.achieved ? "Đã đạt" : badge.condition}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Chứng chỉ của bạn */}
          {courseProgress && (
            <section className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <ScrollText
                    className="h-4 w-4 text-slate-500"
                    aria-hidden="true"
                  />
                  Chứng chỉ của bạn
                </h2>
                <span className="text-xs font-medium text-slate-500">
                  {certificates.length} chứng chỉ
                </span>
              </div>
              <div className="px-6 py-5">
                {certificates.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {certificates.map((cert) => {
                      const dateText = formatDate(
                        cert.completedAt || new Date()
                      );
                      return (
                        <div
                          key={cert.id}
                          className="rounded-lg border-2 border-double border-green-700 bg-green-50/40 px-5 py-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span
                              className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-green-700 ring-1 ring-green-200"
                              aria-hidden="true"
                            >
                              <ScrollText className="h-5 w-5" />
                            </span>
                            <span className="text-[11px] font-semibold uppercase tracking-widest text-green-700">
                              LearnHub
                            </span>
                          </div>
                          <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                            Chứng chỉ hoàn thành
                          </p>
                          <p className="mt-0.5 text-sm font-semibold text-slate-900">
                            {cert.title}
                          </p>
                          <p className="mt-2 text-sm text-slate-600">
                            Học viên:{" "}
                            <span className="font-medium text-slate-900">
                              {profile.full_name}
                            </span>
                          </p>
                          <p className="mt-0.5 text-sm text-slate-600">
                            Ngày hoàn thành: {dateText}
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              openCertificatePrint({
                                courseTitle: cert.title,
                                learnerName: profile.full_name,
                                dateText,
                              })
                            }
                            className="mt-4 inline-flex items-center gap-2 rounded-md bg-green-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
                          >
                            <Printer className="h-4 w-4" aria-hidden="true" />
                            In chứng chỉ
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div>
                    <p className="flex items-start gap-2 text-sm text-slate-600">
                      <BookOpen
                        className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                        aria-hidden="true"
                      />
                      Hoàn thành toàn bộ bài trong một khóa học để nhận chứng
                      chỉ.
                    </p>
                    {nearestCourse && (
                      <div className="mt-4 max-w-md">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium text-slate-900">
                            {nearestCourse.title}
                          </span>
                          <span className="tabular-nums text-slate-500">
                            {nearestCourse.completed}/{nearestCourse.total} bài
                          </span>
                        </div>
                        <div
                          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100"
                          role="progressbar"
                          aria-valuenow={nearestCourse.completed}
                          aria-valuemin={0}
                          aria-valuemax={nearestCourse.total}
                        >
                          <div
                            className="h-full rounded-full bg-[#15803d]"
                            style={{
                              width: `${
                                nearestCourse.total
                                  ? Math.round(
                                      (nearestCourse.completed /
                                        nearestCourse.total) *
                                        100
                                    )
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                        <p className="mt-1.5 text-xs text-slate-500">
                          Còn {nearestCourse.total - nearestCourse.completed}{" "}
                          bài nữa để nhận chứng chỉ khóa này.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

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

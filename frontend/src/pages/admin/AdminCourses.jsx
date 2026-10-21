import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ListTree,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import api, { apiDelete } from "../../lib/api";
import CourseFormDrawer from "../../components/admin/CourseFormDrawer";
import LessonManager from "../../components/admin/LessonManager";

/**
 * AdminCourses — Quản lý khóa học (trang admin).
 *
 * API sử dụng:
 *  - Danh sách: GET /api/admin/courses?q=&page=&per_page=&status=
 *      (BE CHƯA CÓ — cần bổ sung. Nếu API trả 404, trang tự lùi về
 *       GET /api/courses (chỉ khóa đã xuất bản) + lọc/phân trang phía client
 *       và hiện thông báo để admin biết đang ở chế độ hạn chế.)
 *  - Tạo:  POST   /api/admin/courses          (đã có ở BE, qua CourseFormDrawer)
 *  - Sửa:  PUT    /api/admin/courses/:id      (BE CHƯA CÓ — qua CourseFormDrawer)
 *  - Xóa:  DELETE /api/admin/courses/:id      (BE CHƯA CÓ)
 *
 * Số Unit/Lesson: hiển thị khi API trả kèm `unit_count` / `lesson_count`
 * (hoặc mảng `units` / `lessons`); chưa có thì hiện "—".
 */

const PAGE_SIZE = 10;

function getErrorMessage(err) {
  return (
    err?.serverMessage ||
    err?.response?.data?.error?.message ||
    err?.message ||
    "Đã xảy ra lỗi, vui lòng thử lại."
  );
}

function isNotFound(err) {
  return err?.response?.status === 404 || err?.status === 404;
}

/**
 * Chuẩn hoá response danh sách về { items, total, serverPaged }.
 * api.js đã unwrap: payload nằm ở response.data, meta phân trang (total, page,
 * per_page) nằm ở response.meta. Nếu không có meta total -> BE trả toàn bộ
 * danh sách, trang sẽ tự lọc + phân trang phía client.
 */
function normalizeListResponse(payload, meta) {
  const items = Array.isArray(payload)
    ? payload
    : payload?.items || payload?.courses || payload?.data || [];
  const total =
    typeof meta?.total === "number"
      ? meta.total
      : typeof payload?.total === "number"
        ? payload.total
        : null;
  return { items, total, serverPaged: total !== null };
}

function applyClientFilters(items, { q, status }) {
  let result = items;
  const keyword = (q || "").trim().toLowerCase();
  if (keyword) {
    result = result.filter(
      (c) =>
        c.title?.toLowerCase().includes(keyword) ||
        c.slug?.toLowerCase().includes(keyword)
    );
  }
  if (status === "published") result = result.filter((c) => c.is_published);
  if (status === "draft") result = result.filter((c) => !c.is_published);
  return result;
}

async function fetchCourses({ page, q, status }) {
  try {
    const res = await api.get("/api/admin/courses", {
      params: { q: q || undefined, page, per_page: PAGE_SIZE, status: status !== "all" ? status : undefined },
    });
    const normalized = normalizeListResponse(res.data, res.meta);
    if (normalized.serverPaged) {
      return { items: normalized.items, total: normalized.total, limitedMode: false };
    }
    const filtered = applyClientFilters(normalized.items, { q, status });
    return {
      items: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      total: filtered.length,
      limitedMode: false,
    };
  } catch (err) {
    if (!isNotFound(err)) throw err;
    // Fallback tạm trong lúc BE chưa có GET /api/admin/courses:
    // chỉ lấy được khóa đã xuất bản từ API public.
    const res = await api.get("/api/courses");
    const all = Array.isArray(res.data) ? res.data : [];
    const filtered = applyClientFilters(all, { q, status: "published" });
    return {
      items: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      total: filtered.length,
      limitedMode: true,
    };
  }
}

function countOf(course, countKey, arrayKey) {
  if (typeof course?.[countKey] === "number") return course[countKey];
  if (Array.isArray(course?.[arrayKey])) return course[arrayKey].length;
  return null;
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

/* ---------------------------------- Toast --------------------------------- */

function ToastViewport({ toasts, dismiss }) {
  return (
    <div className="fixed bottom-6 right-6 z-[70] flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-2.5 rounded-md border border-slate-200 bg-white px-3.5 py-3 shadow-lg border-l-4 ${
            toast.type === "success" ? "border-l-[#15803d]" : "border-l-red-600"
          }`}
          role="status"
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#15803d]" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          )}
          <p className="flex-1 text-sm text-slate-800">{toast.message}</p>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Đóng thông báo"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------- Page ---------------------------------- */

export default function AdminCourses() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all"); // all | published | draft
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState(null);
  const [deletingCourse, setDeletingCourse] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [expandedCourseId, setExpandedCourseId] = useState(null);
  const [toasts, setToasts] = useState([]);

  // Debounce ô tìm kiếm 300ms, đổi từ khóa thì về trang 1
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const notify = ({ type = "success", message }) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };
  const dismissToast = (id) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  const coursesQuery = useQuery({
    queryKey: ["admin", "courses", { page, q: search, status }],
    queryFn: () => fetchCourses({ page, q: search, status }),
    placeholderData: (prev) => prev,
  });

  const deleteMutation = useMutation({
    mutationFn: (courseId) => apiDelete(`/api/admin/courses/${courseId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "courses"] });
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      notify({ type: "success", message: "Đã xóa khóa học." });
      setDeletingCourse(null);
      setDeleteError("");
    },
    onError: (err) => setDeleteError(getErrorMessage(err)),
  });

  const courses = coursesQuery.data?.items || [];
  const total = coursesQuery.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const limitedMode = Boolean(coursesQuery.data?.limitedMode);

  const pageNumbers = useMemo(() => {
    const pages = [];
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    for (let i = start; i <= Math.min(totalPages, start + 4); i += 1) pages.push(i);
    return pages;
  }, [page, totalPages]);

  // Xuất CSV đúng dữ liệu đang hiển thị trong state (đã lọc theo từ khóa/trạng thái).
  const handleExportCsv = () => {
    const headers = ["id", "title", "level", "is_published", "lesson_count"];
    const rows = courses.map((course) => [
      course.id,
      course.title ?? "",
      course.level ?? "",
      course.is_published ? "true" : "false",
      countOf(course, "lesson_count", "lessons") ?? "",
    ]);
    downloadCsv("courses.csv", headers, rows);
  };

  const openCreate = () => {
    setEditingCourse(null);
    setDrawerOpen(true);
  };
  const openEdit = (course) => {
    setEditingCourse(course);
    setDrawerOpen(true);
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      {/* Header trang */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Quản lý khóa học</h1>
          <p className="mt-1 text-sm text-slate-500">
            Tạo, chỉnh sửa và xuất bản các khóa học trong hệ thống.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={courses.length === 0}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Xuất CSV
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-[#15803d] px-4 text-sm font-medium text-white hover:bg-[#166534]"
          >
            <Plus className="h-4 w-4" />
            Tạo khóa học
          </button>
        </div>
      </div>

      {limitedMode && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            API quản trị khóa học chưa sẵn sàng — đang hiển thị tạm các khóa học
            đã xuất bản từ API công khai. Khóa học bản nháp sẽ không xuất hiện ở đây.
          </span>
        </div>
      )}

      {/* Thanh công cụ */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#15803d] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20"
            placeholder="Tìm theo tên hoặc slug khóa học..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <select
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:border-[#15803d] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="published">Đã xuất bản</option>
          <option value="draft">Bản nháp</option>
        </select>
        {!coursesQuery.isLoading && !coursesQuery.isError && (
          <span className="text-sm text-slate-500">Tổng số: {total} khóa học</span>
        )}
      </div>

      {/* Bảng danh sách */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Khóa học</th>
                <th className="px-4 py-3 font-medium">Trình độ</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-4 py-3 text-center font-medium">Chương</th>
                <th className="px-4 py-3 text-center font-medium">Bài học</th>
                <th className="px-4 py-3 text-right font-medium">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {coursesQuery.isLoading &&
                [1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-4 py-3">
                      <div className="h-5 animate-pulse rounded bg-slate-100" />
                    </td>
                  </tr>
                ))}

              {!coursesQuery.isLoading &&
                courses.map((course) => {
                  const unitCount = countOf(course, "unit_count", "units");
                  const lessonCount = countOf(course, "lesson_count", "lessons");
                  const isExpanded = expandedCourseId === course.id;
                  return (
                    <Fragment key={course.id}>
                      <tr className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{course.title}</p>
                          <p className="mt-0.5 text-xs text-slate-500">/{course.slug}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {course.level || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {course.is_published ? (
                            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#15803d]">
                              <span className="h-2 w-2 rounded-full bg-[#15803d]" />
                              Đã xuất bản
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                              <span className="h-2 w-2 rounded-full bg-slate-400" />
                              Bản nháp
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-700">
                          {unitCount ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-700">
                          {lessonCount ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedCourseId(isExpanded ? null : course.id)
                              }
                              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium ${
                                isExpanded
                                  ? "bg-slate-100 text-slate-900"
                                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              }`}
                              title="Quản lý chương và bài học"
                            >
                              <ListTree className="h-4 w-4" />
                              Bài học
                              <ChevronDown
                                className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEdit(course)}
                              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              title="Sửa khóa học"
                              aria-label={`Sửa khóa học ${course.title}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeletingCourse(course);
                                setDeleteError("");
                              }}
                              className="rounded-md p-2 text-slate-600 hover:bg-red-50 hover:text-red-600"
                              title="Xóa khóa học"
                              aria-label={`Xóa khóa học ${course.title}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="bg-slate-50 px-4 py-3">
                            <LessonManager courseId={course.id} onNotify={notify} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Trạng thái lỗi */}
        {coursesQuery.isError && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <div>
              <p className="font-medium text-slate-900">Không tải được danh sách khóa học</p>
              <p className="mt-1 text-sm text-slate-500">
                {getErrorMessage(coursesQuery.error)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => coursesQuery.refetch()}
              className="h-9 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Thử lại
            </button>
          </div>
        )}

        {/* Trạng thái trống */}
        {!coursesQuery.isLoading && !coursesQuery.isError && courses.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <BookOpen className="h-8 w-8 text-slate-400" />
            {search || status !== "all" ? (
              <>
                <p className="font-medium text-slate-900">Không tìm thấy khóa học phù hợp</p>
                <p className="text-sm text-slate-500">
                  Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc trạng thái.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-slate-900">Chưa có khóa học nào</p>
                <p className="text-sm text-slate-500">
                  Tạo khóa học đầu tiên để bắt đầu xây dựng lộ trình học.
                </p>
                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-[#15803d] px-4 text-sm font-medium text-white hover:bg-[#166534]"
                >
                  <Plus className="h-4 w-4" />
                  Tạo khóa học
                </button>
              </>
            )}
          </div>
        )}

        {/* Phân trang */}
        {!coursesQuery.isError && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
            <p className="text-sm text-slate-500">
              Hiển thị {(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, total)} trong {total} khóa học
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Trang trước"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {pageNumbers.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPage(p)}
                  className={`h-8 w-8 rounded-md text-sm font-medium ${
                    p === page
                      ? "bg-[#15803d] text-white"
                      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Trang sau"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Drawer tạo / sửa */}
      <CourseFormDrawer
        open={drawerOpen}
        course={editingCourse}
        onClose={() => setDrawerOpen(false)}
        onSaved={(message) => notify({ type: "success", message })}
      />

      {/* Dialog xác nhận xóa */}
      {deletingCourse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="alertdialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => !deleteMutation.isPending && setDeletingCourse(null)}
          />
          <div className="relative w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Xóa khóa học</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Bạn có chắc muốn xóa khóa học{" "}
                  <span className="font-medium text-slate-900">
                    "{deletingCourse.title}"
                  </span>
                  ? Toàn bộ chương, bài học và bài tập bên trong cũng sẽ bị xóa.
                  Thao tác này không thể hoàn tác.
                </p>
              </div>
            </div>
            {deleteError && (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => setDeletingCourse(null)}
                className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deletingCourse.id)}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Xóa khóa học
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastViewport toasts={toasts} dismiss={dismissToast} />
    </div>
  );
}

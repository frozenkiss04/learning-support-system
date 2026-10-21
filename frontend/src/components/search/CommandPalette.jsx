import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, BookOpen, Loader2, Search } from "lucide-react";
import { apiGet } from "../../lib/api";

/**
 * Command palette tìm bài học (Ctrl/Cmd + K).
 *
 * Dữ liệu tải lười ở lần mở đầu tiên: GET /api/courses, sau đó
 * GET /api/courses/:id/path cho từng khóa để lấy units/lessons
 * (kèm id + status), và được cache trong state cho các lần mở sau.
 *
 * Lọc không dấu: tiêu đề bài học / khóa học / chương được chuẩn hóa
 * bỏ dấu tiếng Việt trước khi so khớp với từ khóa.
 *
 * Props:
 * - open: boolean — palette có đang mở hay không (controlled).
 * - onOpenChange(open): callback đổi trạng thái mở/đóng. Palette tự
 *   lắng nghe Ctrl/Cmd+K để bật/tắt và Esc để đóng.
 */
export default function CommandPalette({ open, onOpenChange }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const [query, setQuery] = useState("");
  const [items, setItems] = useState(null); // null = chưa tải
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const close = () => onOpenChange(false);

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const courses = await apiGet("/api/courses");
      const courseList = Array.isArray(courses) ? courses : [];
      const paths = await Promise.all(
        courseList.map((course) =>
          apiGet(`/api/courses/${course.id}/path`).catch(() => null),
        ),
      );
      const flat = [];
      paths.forEach((path, courseIdx) => {
        if (!path) return;
        const courseTitle =
          path.course?.title ?? courseList[courseIdx]?.title ?? "Khóa học";
        const units = [...(path.units ?? [])].sort(
          (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
        );
        units.forEach((unit) => {
          (unit.lessons ?? []).forEach((lesson) => {
            flat.push({
              lessonId: lesson.id,
              lessonTitle: lesson.title ?? "Bài học",
              courseTitle,
              unitTitle: unit.title ?? "",
              status: lesson.status ?? null,
            });
          });
        });
      });
      setItems(flat);
    } catch (err) {
      setLoadError(
        err?.response?.data?.error?.message ||
          err?.serverMessage ||
          "Không tải được danh sách bài học. Vui lòng thử lại.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Tải lười ở lần mở đầu tiên + reset trạng thái mỗi lần mở.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    if (items === null && !loading) {
      load();
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  // Tự lắng nghe Ctrl/Cmd + K (bật/tắt) và Esc (đóng) khi component còn mount.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        onOpenChange(!open);
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const needle = stripAccents(query.trim());
    if (!needle) return items;
    return items.filter(
      (item) =>
        stripAccents(item.lessonTitle).includes(needle) ||
        stripAccents(item.courseTitle).includes(needle) ||
        stripAccents(item.unitTitle).includes(needle),
    );
  }, [items, query]);

  const visible = filtered.slice(0, 50);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-idx="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const select = (item) => {
    if (!item) return;
    onOpenChange(false);
    navigate(`/lessons/${item.lessonId}`);
  };

  const handleInputKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((value) => Math.min(value + 1, visible.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(visible[activeIndex]);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 px-4 pt-[10vh]"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Tìm bài học"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Ô nhập từ khóa */}
        <div className="flex items-center gap-3 border-b border-slate-200 px-4">
          <Search
            className="h-5 w-5 shrink-0 text-slate-400"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Tìm bài học, khóa học..."
            aria-label="Từ khóa tìm bài học"
            className="h-12 w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
            ESC
          </kbd>
        </div>

        {/* Kết quả */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-10 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Đang tải danh sách bài học...
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center px-3 py-10 text-center">
              <AlertCircle
                className="h-6 w-6 text-red-500"
                aria-hidden="true"
              />
              <p className="mt-2 text-sm text-slate-600">{loadError}</p>
              <button
                type="button"
                onClick={load}
                className="mt-3 rounded-md bg-primary-700 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
              >
                Thử lại
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <Search
                className="mx-auto h-6 w-6 text-slate-300"
                aria-hidden="true"
              />
              <p className="mt-2 text-sm font-medium text-slate-700">
                Không tìm thấy bài học nào
              </p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-slate-500">
                {query.trim()
                  ? `Không có bài học nào khớp với “${query.trim()}”. Thử từ khóa ngắn hơn hoặc không dấu.`
                  : "Chưa có bài học nào trong các khóa học đã xuất bản."}
              </p>
            </div>
          ) : (
            <ul role="listbox" aria-label="Kết quả tìm bài học">
              {visible.map((item, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <li key={`${item.lessonId}-${idx}`}>
                    <button
                      type="button"
                      data-idx={idx}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => select(item)}
                      className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                        isActive ? "bg-primary-50" : "bg-white"
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${
                          isActive
                            ? "border-primary-200 bg-white text-primary-700"
                            : "border-slate-200 bg-slate-50 text-slate-500"
                        }`}
                      >
                        <BookOpen className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {item.lessonTitle}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {item.courseTitle}
                          {item.unitTitle ? ` · ${item.unitTitle}` : ""}
                        </span>
                      </span>
                      {item.status === "COMPLETED" && (
                        <span className="shrink-0 rounded border border-primary-200 bg-white px-1.5 py-px text-[11px] font-medium text-primary-700">
                          Đã hoàn thành
                        </span>
                      )}
                      {item.status === "LOCKED" && (
                        <span className="shrink-0 rounded border border-slate-200 bg-white px-1.5 py-px text-[11px] font-medium text-slate-500">
                          Đã khóa
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Gợi ý phím */}
        <div className="flex items-center gap-4 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
          <span>
            <span className="font-medium text-slate-500">↑↓</span> di chuyển
          </span>
          <span>
            <span className="font-medium text-slate-500">Enter</span> mở bài
            học
          </span>
          <span>
            <span className="font-medium text-slate-500">Esc</span> đóng
          </span>
          {filtered.length > visible.length && (
            <span className="ml-auto">
              Hiển thị {visible.length}/{filtered.length} kết quả
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Bỏ dấu tiếng Việt + hạ chữ thường để so khớp tìm kiếm không dấu. */
function stripAccents(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

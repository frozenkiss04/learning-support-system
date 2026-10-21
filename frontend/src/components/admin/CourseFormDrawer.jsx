import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, RefreshCw, X } from "lucide-react";
import { apiPost, apiPut } from "../../lib/api";

/**
 * CourseFormDrawer — form tạo / sửa khóa học trong Drawer trượt từ phải.
 *
 * Props:
 *  - open: boolean
 *  - course: object | null  (null = tạo mới, có object = sửa)
 *  - onClose: () => void
 *  - onSaved: (message: string) => void  (trang cha hiển thị toast)
 *
 * API:
 *  - Tạo:  POST /api/admin/courses            (đã có ở BE)
 *  - Sửa:  PUT  /api/admin/courses/:id        (BE CHƯA CÓ — cần bổ sung)
 */

export const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

/** Sinh slug từ tiêu đề, bỏ dấu tiếng Việt. VD: "Tiếng Anh cơ bản" -> "tieng-anh-co-ban" */
export function slugify(text) {
  return (text || "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // bỏ dấu tổ hợp U+0300–U+036F sau khi tách NFD
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-");
}

const inputClass =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#15803d] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20 disabled:bg-slate-50 disabled:text-slate-500";
const labelClass = "mb-1.5 block text-sm font-medium text-slate-700";

function getErrorMessage(err) {
  return (
    err?.serverMessage ||
    err?.response?.data?.error?.message ||
    err?.message ||
    "Đã xảy ra lỗi, vui lòng thử lại."
  );
}

export default function CourseFormDrawer({ open, course, onClose, onSaved }) {
  const isEdit = Boolean(course);
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("A1");
  const [isPublished, setIsPublished] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  // Nạp dữ liệu khi mở drawer (tạo mới -> form trống, sửa -> điền từ course)
  useEffect(() => {
    if (!open) return;
    setTitle(course?.title || "");
    setSlug(course?.slug || "");
    setSlugTouched(Boolean(course)); // sửa: không tự ghi đè slug khi đổi title
    setDescription(course?.description || "");
    setLevel(course?.level || "A1");
    setIsPublished(Boolean(course?.is_published));
    setFormError("");
    setFieldErrors({});
  }, [open, course]);

  const mutation = useMutation({
    mutationFn: (payload) =>
      isEdit
        ? apiPut(`/api/admin/courses/${course.id}`, payload)
        : apiPost("/api/admin/courses", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "courses"] });
      queryClient.invalidateQueries({ queryKey: ["courses"] });
      onSaved?.(isEdit ? "Đã cập nhật khóa học." : "Đã tạo khóa học mới.");
      onClose?.();
    },
    onError: (err) => setFormError(getErrorMessage(err)),
  });

  if (!open) return null;

  const handleTitleChange = (value) => {
    setTitle(value);
    if (!slugTouched) setSlug(slugify(value));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const errors = {};
    if (!title.trim()) errors.title = "Tên khóa học là bắt buộc.";
    if (!slug.trim()) errors.slug = "Slug là bắt buộc.";
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim()))
      errors.slug = "Slug chỉ gồm chữ thường, số và dấu gạch ngang.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate({
      title: title.trim(),
      slug: slug.trim(),
      description: description.trim(),
      level,
      is_published: isPublished,
    });
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      {/* Overlay phẳng, không blur */}
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {isEdit ? "Sửa khóa học" : "Tạo khóa học"}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {isEdit
                ? "Cập nhật thông tin khóa học."
                : "Khóa học mới mặc định là bản nháp nếu chưa xuất bản."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Đóng"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {formError && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <label htmlFor="course-title" className={labelClass}>
                Tên khóa học <span className="text-red-600">*</span>
              </label>
              <input
                id="course-title"
                className={inputClass}
                placeholder="VD: Tiếng Anh giao tiếp A1"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
              />
              {fieldErrors.title && (
                <p className="mt-1.5 text-sm text-red-600">{fieldErrors.title}</p>
              )}
            </div>

            <div>
              <label htmlFor="course-slug" className={labelClass}>
                Slug <span className="text-red-600">*</span>
              </label>
              <div className="flex gap-2">
                <input
                  id="course-slug"
                  className={inputClass}
                  placeholder="tieng-anh-giao-tiep-a1"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value);
                    setSlugTouched(true);
                  }}
                />
                <button
                  type="button"
                  title="Sinh lại slug từ tên khóa học"
                  onClick={() => {
                    setSlug(slugify(title));
                    setSlugTouched(false);
                  }}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  Sinh lại
                </button>
              </div>
              {fieldErrors.slug ? (
                <p className="mt-1.5 text-sm text-red-600">{fieldErrors.slug}</p>
              ) : (
                <p className="mt-1.5 text-xs text-slate-500">
                  Tự sinh từ tên khóa học, dùng trong đường dẫn. Có thể sửa tay.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="course-description" className={labelClass}>
                Mô tả
              </label>
              <textarea
                id="course-description"
                rows={4}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#15803d] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20"
                placeholder="Giới thiệu ngắn về nội dung và đối tượng của khóa học..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="course-level" className={labelClass}>
                Trình độ
              </label>
              <select
                id="course-level"
                className={inputClass}
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              >
                {LEVELS.map((lv) => (
                  <option key={lv} value={lv}>
                    {lv}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#15803d]"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  Xuất bản khóa học
                </span>
                <span className="block text-sm text-slate-500">
                  Học viên chỉ nhìn thấy các khóa học đã xuất bản.
                </span>
              </span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-[#15803d] px-4 text-sm font-medium text-white hover:bg-[#166534] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Lưu thay đổi" : "Tạo khóa học"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

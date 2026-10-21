import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Layers,
  Loader2,
  Plus,
} from "lucide-react";
import { apiGet, apiPost } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";

/**
 * LessonManager — quản lý chương (Unit) và bài học (Lesson) của 1 khóa học.
 * Dùng nhúng trong hàng mở rộng của bảng khóa học ở trang AdminCourses.
 *
 * Props:
 *  - courseId: number
 *  - onNotify: (toast: { type: "success" | "error", message: string }) => void
 *
 * API:
 *  - Đọc cây chương/bài: GET  /api/courses/:courseId/path        (đã có ở BE)
 *  - Tạo chương:          POST /api/admin/courses/:courseId/units (đã có ở BE)
 *  - Tạo bài học:         POST /api/admin/units/:unitId/lessons   (BE CHƯA CÓ — cần bổ sung)
 *    Body kỳ vọng: { title, description?, xp_reward, order_index }
 */

function getErrorMessage(err) {
  return (
    err?.serverMessage ||
    err?.response?.data?.error?.message ||
    err?.message ||
    "Đã xảy ra lỗi, vui lòng thử lại."
  );
}

const smallInputClass =
  "h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#15803d] focus:outline-none focus:ring-2 focus:ring-[#15803d]/20";

export default function LessonManager({ courseId, onNotify }) {
  const queryClient = useQueryClient();
  const [openUnits, setOpenUnits] = useState({});
  const [newUnitTitle, setNewUnitTitle] = useState("");
  const [unitError, setUnitError] = useState("");
  // Form tạo bài học theo unit: { [unitId]: { title, xp } } và unit đang mở form
  const [lessonForms, setLessonForms] = useState({});
  const [activeLessonUnit, setActiveLessonUnit] = useState(null);
  const [lessonError, setLessonError] = useState("");

  const pathQuery = useQuery({
    queryKey: queryKeys.courses.path(courseId),
    queryFn: () => apiGet(`/api/courses/${courseId}/path`),
    enabled: Boolean(courseId),
  });

  const units = pathQuery.data?.units || [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.courses.path(courseId) });
    queryClient.invalidateQueries({ queryKey: ["admin", "courses"] });
  };

  const createUnitMutation = useMutation({
    mutationFn: (title) =>
      apiPost(`/api/admin/courses/${courseId}/units`, {
        title,
        order_index: units.length + 1,
      }),
    onSuccess: () => {
      setNewUnitTitle("");
      setUnitError("");
      invalidate();
      onNotify?.({ type: "success", message: "Đã thêm chương mới." });
    },
    onError: (err) => setUnitError(getErrorMessage(err)),
  });

  const createLessonMutation = useMutation({
    mutationFn: ({ unitId, title, xp }) =>
      apiPost(`/api/admin/units/${unitId}/lessons`, {
        title,
        xp_reward: xp,
        order_index: (lessonForms[unitId]?.nextIndex ?? 1),
      }),
    onSuccess: (_data, variables) => {
      setLessonForms((prev) => ({ ...prev, [variables.unitId]: { title: "", xp: 10 } }));
      setLessonError("");
      setActiveLessonUnit(null);
      invalidate();
      onNotify?.({ type: "success", message: "Đã thêm bài học mới." });
    },
    onError: (err) => setLessonError(getErrorMessage(err)),
  });

  const toggleUnit = (unitId) =>
    setOpenUnits((prev) => ({ ...prev, [unitId]: !prev[unitId] }));

  const handleCreateUnit = (e) => {
    e.preventDefault();
    if (!newUnitTitle.trim()) {
      setUnitError("Tên chương là bắt buộc.");
      return;
    }
    createUnitMutation.mutate(newUnitTitle.trim());
  };

  const handleCreateLesson = (e, unit) => {
    e.preventDefault();
    const form = lessonForms[unit.id] || { title: "", xp: 10 };
    if (!form.title.trim()) {
      setLessonError("Tên bài học là bắt buộc.");
      return;
    }
    createLessonMutation.mutate({
      unitId: unit.id,
      title: form.title.trim(),
      xp: Number(form.xp) || 10,
    });
  };

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Layers className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-900">
          Chương và bài học
        </h3>
        {!pathQuery.isLoading && !pathQuery.isError && (
          <span className="text-sm text-slate-500">
            ({units.length} chương,{" "}
            {units.reduce((sum, u) => sum + (u.lessons?.length || 0), 0)} bài học)
          </span>
        )}
      </div>

      {pathQuery.isLoading && (
        <div className="space-y-2" aria-label="Đang tải">
          {[1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-slate-200" />
          ))}
        </div>
      )}

      {pathQuery.isError && (
        <div className="flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Không tải được danh sách chương. {getErrorMessage(pathQuery.error)}
          </span>
          <button
            type="button"
            onClick={() => pathQuery.refetch()}
            className="font-medium text-red-700 underline hover:text-red-800"
          >
            Thử lại
          </button>
        </div>
      )}

      {!pathQuery.isLoading && !pathQuery.isError && (
        <>
          {units.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-sm text-slate-500">
              Khóa học chưa có chương nào. Thêm chương đầu tiên ở bên dưới.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
              {units.map((unit) => {
                const isOpen = openUnits[unit.id] ?? true;
                const lessons = unit.lessons || [];
                const form = lessonForms[unit.id] || { title: "", xp: 10 };
                return (
                  <li key={unit.id}>
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => toggleUnit(unit.id)}
                        className="rounded p-1 text-slate-500 hover:bg-slate-100"
                        aria-label={isOpen ? "Thu gọn chương" : "Mở chương"}
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                      <span className="flex-1 truncate text-sm font-medium text-slate-800">
                        Chương {unit.order_index}. {unit.title}
                      </span>
                      <span className="text-xs text-slate-500">
                        {lessons.length} bài học
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveLessonUnit(
                            activeLessonUnit === unit.id ? null : unit.id
                          );
                          setLessonError("");
                          setLessonForms((prev) => ({
                            ...prev,
                            [unit.id]: {
                              ...(prev[unit.id] || { title: "", xp: 10 }),
                              nextIndex: lessons.length + 1,
                            },
                          }));
                        }}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Thêm bài học
                      </button>
                    </div>

                    {isOpen && (
                      <div className="border-t border-slate-100 px-3 py-2">
                        {lessons.length === 0 ? (
                          <p className="py-1 pl-7 text-sm text-slate-500">
                            Chưa có bài học nào trong chương này.
                          </p>
                        ) : (
                          <ul className="space-y-1">
                            {lessons.map((lesson) => (
                              <li
                                key={lesson.id}
                                className="flex items-center gap-2 rounded-md px-2 py-1.5 pl-7 hover:bg-slate-50"
                              >
                                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                                <span className="flex-1 truncate text-sm text-slate-700">
                                  {lesson.order_index}. {lesson.title}
                                </span>
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                                  {lesson.xp_reward} XP
                                </span>
                                <span
                                  className={
                                    lesson.status === "COMPLETED"
                                      ? "text-xs font-medium text-[#15803d]"
                                      : "text-xs text-slate-400"
                                  }
                                >
                                  {lesson.status === "COMPLETED"
                                    ? "Đã hoàn thành"
                                    : "Đang mở"}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {activeLessonUnit === unit.id && (
                          <form
                            onSubmit={(e) => handleCreateLesson(e, unit)}
                            className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2.5"
                          >
                            <input
                              className={`${smallInputClass} min-w-48 flex-1`}
                              placeholder="Tên bài học, VD: Động từ to be"
                              value={form.title}
                              onChange={(e) =>
                                setLessonForms((prev) => ({
                                  ...prev,
                                  [unit.id]: { ...form, title: e.target.value },
                                }))
                              }
                            />
                            <input
                              type="number"
                              min={0}
                              className={`${smallInputClass} w-24`}
                              placeholder="XP"
                              value={form.xp}
                              onChange={(e) =>
                                setLessonForms((prev) => ({
                                  ...prev,
                                  [unit.id]: { ...form, xp: e.target.value },
                                }))
                              }
                            />
                            <button
                              type="submit"
                              disabled={createLessonMutation.isPending}
                              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#15803d] px-3 text-sm font-medium text-white hover:bg-[#166534] disabled:opacity-60"
                            >
                              {createLessonMutation.isPending && (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              )}
                              Thêm
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveLessonUnit(null)}
                              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Hủy
                            </button>
                            {lessonError && (
                              <p className="w-full text-sm text-red-600">
                                {lessonError}
                              </p>
                            )}
                          </form>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Form thêm chương — dùng API đã có ở BE */}
          <form
            onSubmit={handleCreateUnit}
            className="mt-3 flex flex-wrap items-center gap-2"
          >
            <input
              className={`${smallInputClass} min-w-56 flex-1 bg-white`}
              placeholder="Tên chương mới, VD: Thì hiện tại đơn"
              value={newUnitTitle}
              onChange={(e) => setNewUnitTitle(e.target.value)}
            />
            <button
              type="submit"
              disabled={createUnitMutation.isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#15803d] px-3 text-sm font-medium text-white hover:bg-[#166534] disabled:opacity-60"
            >
              {createUnitMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Thêm chương
            </button>
            {unitError && (
              <p className="w-full text-sm text-red-600">{unitError}</p>
            )}
          </form>
        </>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, BookOpen, ClipboardList, Play } from 'lucide-react';

import { apiGet } from '../../lib/api';
import CoursePicker from '../../components/learning/CoursePicker';
import UnitSection from '../../components/learning/UnitSection';
import LearnSkeleton from '../../components/learning/LearnSkeleton';
import LearnEmptyState from '../../components/learning/LearnEmptyState';

/**
 * Learning path page (Duolingo-style path, enterprise layout).
 *
 * Data flow:
 * 1. GET /api/courses            -> published courses (api client unwraps `data`)
 * 2. GET /api/courses/:id/path   -> { course, units: [{ lessons: [...] }] }
 *
 * Lessons are numbered globally across units. Clicking an AVAILABLE or
 * COMPLETED lesson navigates to /lessons/:id; LOCKED lessons are inert.
 */
export default function LearnPage() {
  const navigate = useNavigate();
  const [selectedCourseId, setSelectedCourseId] = useState(null);

  const coursesQuery = useQuery({
    queryKey: ['courses'],
    queryFn: () => apiGet('/api/courses'),
  });
  const courses = coursesQuery.data ?? [];
  const courseId = selectedCourseId ?? courses[0]?.id ?? null;

  const pathQuery = useQuery({
    queryKey: ['course-path', courseId],
    queryFn: () => apiGet(`/api/courses/${courseId}/path`),
    enabled: courseId != null,
  });

  const units = useMemo(() => {
    const raw = pathQuery.data?.units ?? [];
    return [...raw].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  }, [pathQuery.data]);

  // Flatten lessons in path order for totals, numbering and "next lesson".
  const flatLessons = useMemo(() => units.flatMap((u) => u.lessons ?? []), [units]);
  const totalLessons = flatLessons.length;
  const completedLessons = flatLessons.filter((l) => l.status === 'COMPLETED').length;
  const coursePercent = totalLessons
    ? Math.round((completedLessons / totalLessons) * 100)
    : 0;
  const earnedXp = flatLessons
    .filter((l) => l.status === 'COMPLETED')
    .reduce((sum, l) => sum + (l.xp_reward ?? 0), 0);
  const nextLesson = flatLessons.find(
    (l) => l.status !== 'COMPLETED' && l.status !== 'LOCKED',
  );

  const openLesson = (lesson) => navigate(`/lessons/${lesson.id}`);

  // Numbering offset per unit (lessons are numbered across the whole course).
  const unitOffsets = useMemo(() => {
    const offsets = [];
    let acc = 0;
    for (const unit of units) {
      offsets.push(acc);
      acc += (unit.lessons ?? []).length;
    }
    return offsets;
  }, [units]);

  /* ---------- States ---------- */

  if (coursesQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <LearnSkeleton />
      </div>
    );
  }

  if (coursesQuery.isError) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <LearnEmptyState
          icon={AlertCircle}
          title="Không tải được danh sách khóa học"
          description="Đã xảy ra lỗi khi kết nối tới máy chủ. Vui lòng thử lại."
          action={
            <button
              type="button"
              onClick={() => coursesQuery.refetch()}
              className="inline-flex h-10 items-center rounded-md bg-green-700 px-4 text-sm font-medium text-white hover:bg-green-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
            >
              Thử lại
            </button>
          }
        />
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
        <LearnEmptyState
          icon={BookOpen}
          title="Chưa có khóa học nào"
          description="Các khóa học sẽ xuất hiện tại đây ngay khi được quản trị viên xuất bản."
        />
      </div>
    );
  }

  const course = pathQuery.data?.course ?? courses.find((c) => c.id === courseId);

  /* ---------- Page ---------- */

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      {/* Page header */}
      <header className="rounded-lg border border-slate-200 bg-white px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Lộ trình học
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">
              {course?.title ?? 'Khóa học'}
            </h1>
            {course?.description && (
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {course.description}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {course?.level && (
                <span className="inline-flex items-center rounded border border-slate-200 px-1.5 py-px font-medium text-slate-600">
                  Trình độ {course.level}
                </span>
              )}
              <span>
                {units.length} chương · {totalLessons} bài học
              </span>
              {earnedXp > 0 && <span>· Đã nhận {earnedXp} XP</span>}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
            <CoursePicker
              courses={courses}
              value={courseId}
              onChange={setSelectedCourseId}
            />
            {nextLesson && (
              <button
                type="button"
                onClick={() => openLesson(nextLesson)}
                className="inline-flex h-10 max-w-72 items-center justify-center gap-2 rounded-md bg-green-700 px-4 text-sm font-medium text-white hover:bg-green-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
              >
                <Play className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {completedLessons > 0 ? 'Học tiếp' : 'Bắt đầu học'}: {nextLesson.title}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Course progress — thin bar */}
        <div className="mt-5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-600">Tiến độ khóa học</span>
            <span className="font-medium text-slate-900">
              {completedLessons}/{totalLessons} bài · {coursePercent}%
            </span>
          </div>
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuenow={coursePercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Tiến độ khóa học"
          >
            <div
              className="h-full bg-green-700 transition-all"
              style={{ width: `${coursePercent}%` }}
            />
          </div>
        </div>
      </header>

      {/* Path body */}
      <div className="mt-6">
        {pathQuery.isLoading && <LearnSkeleton />}

        {pathQuery.isError && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-4">
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
              Không tải được lộ trình học. Vui lòng thử lại.
            </p>
            <button
              type="button"
              onClick={() => pathQuery.refetch()}
              className="inline-flex h-9 shrink-0 items-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Thử lại
            </button>
          </div>
        )}

        {pathQuery.isSuccess && units.length === 0 && (
          <LearnEmptyState
            icon={ClipboardList}
            title="Khóa học chưa có nội dung"
            description="Khóa học này chưa có chương hoặc bài học nào. Vui lòng quay lại sau."
          />
        )}

        {pathQuery.isSuccess && units.length > 0 && (
          <div className="space-y-6">
            {units.map((unit, i) => (
              <UnitSection
                key={unit.id}
                unit={unit}
                unitIndex={i}
                startIndex={unitOffsets[i]}
                onLessonOpen={openLesson}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

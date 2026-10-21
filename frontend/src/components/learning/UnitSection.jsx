import LessonRow from './LessonRow';

/**
 * One unit rendered as a flat bordered block: header (chapter label, title,
 * unit progress with a thin bar) followed by lesson rows separated by hairlines.
 *
 * Props:
 * - unit: { id, title, lessons: [...] }
 * - unitIndex: 0-based position of the unit in the course
 * - startIndex: number of lessons in previous units (for global numbering)
 * - onLessonOpen(lesson)
 */
export default function UnitSection({ unit, unitIndex, startIndex = 0, onLessonOpen }) {
  const lessons = [...(unit.lessons || [])].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
  );
  const completed = lessons.filter((l) => l.status === 'COMPLETED').length;
  const percent = lessons.length ? Math.round((completed / lessons.length) * 100) : 0;

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {/* Unit header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Chương {unitIndex + 1}
          </p>
          <h2 className="mt-0.5 truncate text-base font-semibold text-slate-900">
            {unit.title}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {lessons.length} bài học · Đã hoàn thành {completed}/{lessons.length}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Tiến độ chương ${unitIndex + 1}`}
          >
            <div className="h-full bg-green-700" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-sm font-medium text-slate-600">{percent}%</span>
        </div>
      </div>

      {/* Lesson rows */}
      {lessons.length > 0 ? (
        <div className="divide-y divide-slate-100">
          {lessons.map((lesson, i) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              index={startIndex + i + 1}
              onOpen={onLessonOpen}
            />
          ))}
        </div>
      ) : (
        <p className="px-5 py-4 text-sm text-slate-500">
          Chương này chưa có bài học nào.
        </p>
      )}
    </section>
  );
}

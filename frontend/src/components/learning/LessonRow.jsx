import { Check, ChevronRight, Lock } from 'lucide-react';

/**
 * One lesson as a flat horizontal row.
 *
 * Status comes from the API (`COMPLETED` | `AVAILABLE` | `LOCKED`):
 * - COMPLETED: green check in the number cell, score shown, row re-openable.
 * - AVAILABLE: row is clickable.
 * - LOCKED: dimmed, lock icon, not clickable.
 *
 * Props:
 * - lesson: { id, title, xp_reward, status, score }
 * - index: 1-based display number across the whole course path
 * - onOpen(lesson): called when a clickable row is activated
 */
export default function LessonRow({ lesson, index, onOpen }) {
  const status = lesson.status || 'AVAILABLE';
  const isCompleted = status === 'COMPLETED';
  const isLocked = status === 'LOCKED';
  const clickable = !isLocked;

  const content = (
    <>
      {/* Number / status cell */}
      <span
        className={
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-sm font-medium ' +
          (isCompleted
            ? 'border-green-700 bg-green-700 text-white'
            : isLocked
              ? 'border-slate-200 bg-slate-50 text-slate-400'
              : 'border-slate-200 bg-white text-slate-600')
        }
        aria-hidden="true"
      >
        {isCompleted ? <Check className="h-4 w-4" strokeWidth={2.5} /> : index}
      </span>

      {/* Title + meta */}
      <span className="min-w-0 flex-1">
        <span
          className={
            'block truncate text-sm font-medium ' +
            (isLocked ? 'text-slate-400' : 'text-slate-900')
          }
        >
          {lesson.title}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
          {isCompleted && lesson.score != null && (
            <span className="inline-flex items-center rounded border border-green-200 bg-green-50 px-1.5 py-px font-medium text-green-700">
              Đã đạt {lesson.score}%
            </span>
          )}
          {isLocked && <span>Hoàn thành bài trước để mở khóa</span>}
          {!isCompleted && !isLocked && <span>Sẵn sàng học</span>}
        </span>
      </span>

      {/* XP chip */}
      <span
        className={
          'inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-medium ' +
          (isLocked
            ? 'border-slate-200 text-slate-400'
            : 'border-slate-200 text-slate-600')
        }
      >
        {lesson.xp_reward ?? 0} XP
      </span>

      {/* Trailing affordance */}
      {isLocked ? (
        <Lock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      ) : (
        <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-green-700">
          <span className="hidden sm:inline">{isCompleted ? 'Học lại' : 'Bắt đầu'}</span>
          <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
        </span>
      )}
    </>
  );

  const rowClass =
    'flex w-full items-center gap-4 px-5 py-3.5 text-left ';

  if (!clickable) {
    return (
      <div className={rowClass + 'cursor-not-allowed opacity-60'} aria-disabled="true">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen?.(lesson)}
      onMouseEnter={() => {
        // Prefetch the lesson page chunk on hover so opening a lesson feels instant.
        import('../../pages/learner/LessonPage.jsx').catch(() => {});
      }}
      onFocus={() => {
        import('../../pages/learner/LessonPage.jsx').catch(() => {});
      }}
      className={
        rowClass +
        'transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-inset'
      }
    >
      {content}
    </button>
  );
}

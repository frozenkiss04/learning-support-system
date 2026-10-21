import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, BookOpen, Check, ClipboardList, Pencil, Play, Search, Target, Volume2, VolumeX } from 'lucide-react';

import { apiGet } from '../../lib/api';
import { useCountUp } from '../../hooks/useCountUp';
import * as sounds from '../../lib/sounds';
import CommandPalette from '../../components/search/CommandPalette';
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
  // Thanh tiến độ header: render ở 0% trước, mount xong mới chạy tới giá trị thật.
  const [barReady, setBarReady] = useState(false);
  const [soundOn, setSoundOn] = useState(() => sounds.isEnabled());
  const [paletteOpen, setPaletteOpen] = useState(false);

  /* ----- Mục tiêu XP theo ngày (lưu localStorage) ----- */
  const GOAL_OPTIONS = [20, 30, 50];
  const [dailyGoal, setDailyGoal] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem('lss-daily-goal'));
      return GOAL_OPTIONS.includes(stored) ? stored : 30;
    } catch {
      return 30;
    }
  });
  const [editingGoal, setEditingGoal] = useState(false);
  const todayKey = useMemo(() => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${mm}-${dd}`;
  }, []);
  const [xpBaseline, setXpBaseline] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setBarReady(true), 60);
    return () => window.clearTimeout(timer);
  }, []);

  const toggleSound = () => {
    const next = !soundOn;
    sounds.setEnabled(next);
    setSoundOn(next);
    if (next) sounds.correct(); // tiếng xác nhận nhẹ khi bật lại
  };

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

  // Tổng kết tiến bộ (XP, chuỗi ngày) — dùng cho vòng mục tiêu XP ngày.
  const summaryQuery = useQuery({
    queryKey: ['progress-summary'],
    queryFn: () => apiGet('/api/progress/summary'),
  });
  const totalXp = summaryQuery.data?.xp;

  // Baseline ngày: XP tổng ở lần mở trang đầu tiên trong ngày.
  // XP hôm nay = XP tổng hiện tại - baseline (không âm).
  useEffect(() => {
    if (typeof totalXp !== 'number') return;
    const key = `lss-xp-baseline-${todayKey}`;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored == null) {
        window.localStorage.setItem(key, String(totalXp));
        setXpBaseline(totalXp);
      } else {
        const parsed = Number(stored);
        setXpBaseline(Number.isFinite(parsed) ? parsed : totalXp);
      }
    } catch {
      setXpBaseline(totalXp);
    }
  }, [totalXp, todayKey]);

  const todayXp =
    typeof totalXp === 'number' && xpBaseline != null
      ? Math.max(0, totalXp - xpBaseline)
      : 0;
  const goalPercent =
    dailyGoal > 0 ? Math.min(100, Math.round((todayXp / dailyGoal) * 100)) : 0;
  const goalReached = todayXp >= dailyGoal;

  const chooseGoal = (goal) => {
    setDailyGoal(goal);
    try {
      window.localStorage.setItem('lss-daily-goal', String(goal));
    } catch {
      /* localStorage không khả dụng — bỏ qua */
    }
    setEditingGoal(false);
  };

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
  const earnedXpDisplay = useCountUp(earnedXp);

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
              {earnedXp > 0 && <span>· Đã nhận {earnedXpDisplay} XP</span>}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="Tìm bài học (Ctrl K)"
                title="Tìm bài học (Ctrl K)"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
              >
                <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden md:inline">Tìm bài học...</span>
                <kbd className="hidden shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 lg:inline">
                  Ctrl K
                </kbd>
              </button>
              <CoursePicker
                courses={courses}
                value={courseId}
                onChange={setSelectedCourseId}
              />
              <button
                type="button"
                onClick={toggleSound}
                aria-pressed={soundOn}
                aria-label={soundOn ? 'Tắt âm thanh phản hồi' : 'Bật âm thanh phản hồi'}
                title={soundOn ? 'Tắt âm thanh phản hồi' : 'Bật âm thanh phản hồi'}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
              >
                {soundOn ? (
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
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
              className="h-full bg-green-700 transition-[width] duration-700 ease-out"
              style={{ width: `${barReady ? coursePercent : 0}%` }}
            />
          </div>
        </div>

        {/* Mục tiêu XP hôm nay */}
        {summaryQuery.isSuccess && (
          <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-5">
            <div className="relative h-14 w-14 shrink-0">
              <svg
                viewBox="0 0 56 56"
                className="h-14 w-14 -rotate-90 text-green-700"
                role="progressbar"
                aria-valuenow={todayXp}
                aria-valuemin={0}
                aria-valuemax={dailyGoal}
                aria-label="Mục tiêu XP hôm nay"
              >
                <circle
                  cx="28"
                  cy="28"
                  r="24"
                  fill="none"
                  strokeWidth="6"
                  className="stroke-slate-200"
                />
                <circle
                  cx="28"
                  cy="28"
                  r="24"
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  stroke="currentColor"
                  strokeDasharray={2 * Math.PI * 24}
                  strokeDashoffset={
                    2 * Math.PI * 24 * (1 - (barReady ? goalPercent : 0) / 100)
                  }
                  className="transition-all duration-700 ease-out"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-slate-700">
                {goalPercent}%
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                <Target className="h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
                Mục tiêu hôm nay
              </p>
              <p className="mt-0.5 text-sm text-slate-600">
                <span className="font-semibold tabular-nums text-slate-900">
                  {todayXp}/{dailyGoal} XP
                </span>{' '}
                {goalReached
                  ? '— Tuyệt vời, bạn đã đạt mục tiêu hôm nay!'
                  : `— Còn ${dailyGoal - todayXp} XP nữa để đạt mục tiêu.`}
              </p>
              {typeof summaryQuery.data?.current_streak === 'number' &&
                summaryQuery.data.current_streak > 0 && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    Chuỗi học hiện tại: {summaryQuery.data.current_streak} ngày
                  </p>
                )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {editingGoal ? (
                <>
                  {GOAL_OPTIONS.map((goal) => (
                    <button
                      key={goal}
                      type="button"
                      onClick={() => chooseGoal(goal)}
                      aria-pressed={goal === dailyGoal}
                      className={`inline-flex h-9 items-center rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2 ${
                        goal === dailyGoal
                          ? 'bg-green-700 text-white hover:bg-green-800'
                          : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {goal} XP
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setEditingGoal(false)}
                    className="inline-flex h-9 items-center rounded-md px-2.5 text-sm font-medium text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
                  >
                    Hủy
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingGoal(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
                >
                  {goalReached ? (
                    <Check className="h-4 w-4 text-green-700" aria-hidden="true" />
                  ) : (
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  )}
                  Chỉnh mục tiêu
                </button>
              )}
            </div>
          </div>
        )}
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
          <div className="lss-stagger space-y-6">
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

      {/* Tìm bài học nhanh (Ctrl/Cmd + K) */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

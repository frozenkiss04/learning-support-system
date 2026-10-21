import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  BookOpen,
  Bot,
  ListChecks,
  RefreshCw,
} from "lucide-react";
import { apiGet, apiPost } from "../../lib/api";
import ExerciseRunner from "../../components/exercise/ExerciseRunner";
import ResultPanel from "../../components/exercise/ResultPanel";

// Panel AI Tutor do worker 14 phụ trách (file riêng, không thuộc worker 13).
// Nạp lazy + bắt lỗi import: nếu file chưa tồn tại thì cột phải render
// placeholder dự phòng ở dưới, trang làm bài vẫn chạy bình thường.
const AiTutorPanel = lazy(() =>
  import("../../components/ai/AiTutorPanel").catch(() => ({
    default: AiPanelPlaceholder,
  })),
);

/**
 * Trang làm bài học.
 *
 * API (dùng apiGet/apiPost trong lib/api.js — đã unwrap sẵn `data`):
 * - GET  /api/lessons/:id           -> { id, title, description, xp_reward,
 *                                        exercises: [{ id, type, question, options, order_index }] }
 *   (BE không gửi correct_answer cho học viên.)
 * - POST /api/lessons/:id/submit    body { answers: { [exerciseId]: answer } }
 *                                 -> { score, passed, correct, total, xp_earned,
 *                                      details: [{ exercise_id, is_correct, correct_answer, explanation }] }
 *
 * Bố cục: thanh tiến độ mỏng trên cùng, nội dung bài ở cột chính,
 * cột phải 360px dành cho AI Tutor (worker 14).
 */
export default function LessonPage() {
  const params = useParams();
  const lessonId = params.id ?? params.lessonId;
  const navigate = useNavigate();

  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState(null);

  const loadLesson = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await apiGet(`/api/lessons/${lessonId}`);
      setLesson(data ?? null);
    } catch (err) {
      setLoadError(
        err?.serverMessage ?? err?.message ?? "Không tải được bài học. Vui lòng thử lại.",
      );
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    loadLesson();
  }, [loadLesson]);

  const exercises = useMemo(
    () =>
      [...(lesson?.exercises ?? [])].sort(
        (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
      ),
    [lesson],
  );

  const answeredCount = useMemo(
    () =>
      exercises.filter((ex) => (answers[ex.id] ?? "").toString().trim() !== "").length,
    [answers, exercises],
  );
  const progressPercent = result
    ? 100
    : exercises.length > 0
      ? Math.round((answeredCount / exercises.length) * 100)
      : 0;

  const handleAnswerChange = (exerciseId, answer) => {
    setAnswers((prev) => ({ ...prev, [exerciseId]: answer }));
    setSubmitError("");
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      const data = await apiPost(`/api/lessons/${lessonId}/submit`, { answers });
      setResult(data ?? null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setSubmitError(
        err?.serverMessage ?? err?.message ?? "Nộp bài thất bại. Kiểm tra kết nối rồi thử lại.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = () => {
    setResult(null);
    setAnswers({});
    setSubmitError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const backToPath = () => navigate("/learn");
  // Lộ trình (/learn) đánh dấu bài AVAILABLE tiếp theo — "Học tiếp" quay về đó để vào bài kế.
  const goNext = () => navigate("/learn");

  return (
    <div className="flex flex-col">
      {/* Thanh tiến độ mỏng trên cùng */}
      <div
        className="h-1 w-full bg-slate-200"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Tiến độ làm bài"
      >
        <div
          className="h-full bg-green-700 transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Cột chính: nội dung bài */}
        <main className="min-w-0 flex-1">
          <button
            type="button"
            onClick={backToPath}
            className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Quay lại lộ trình
          </button>

          {loading ? (
            <LessonSkeleton />
          ) : loadError ? (
            <div className="rounded-lg border border-red-200 bg-white px-6 py-10 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
              <p className="mt-3 text-sm font-medium text-slate-900">Đã xảy ra lỗi</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{loadError}</p>
              <button
                type="button"
                onClick={loadLesson}
                className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-md bg-green-700 px-4 text-sm font-medium text-white transition-colors hover:bg-green-800"
              >
                <RefreshCw className="h-4 w-4" />
                Thử lại
              </button>
            </div>
          ) : !lesson ? (
            <EmptyState
              title="Không tìm thấy bài học"
              message="Bài học này không tồn tại hoặc đã bị gỡ khỏi lộ trình."
              onBack={backToPath}
            />
          ) : (
            <>
              <header className="mb-6 border-b border-slate-200 pb-5">
                <h1 className="text-2xl font-bold leading-8 text-slate-900">{lesson.title}</h1>
                {lesson.description ? (
                  <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">
                    {lesson.description}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <ListChecks className="h-4 w-4" />
                    {exercises.length} câu hỏi
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Award className="h-4 w-4" />
                    Hoàn thành nhận {lesson.xp_reward ?? 0} XP
                  </span>
                </div>
              </header>

              {exercises.length === 0 ? (
                <EmptyState
                  title="Bài học chưa có câu hỏi"
                  message="Giáo viên chưa thêm bài tập cho bài học này. Quay lại sau hoặc chọn bài khác trong lộ trình."
                  onBack={backToPath}
                />
              ) : result ? (
                <ResultPanel
                  result={result}
                  exercises={exercises}
                  answers={answers}
                  onNext={goNext}
                  onBackToPath={backToPath}
                  onRetry={handleRetry}
                />
              ) : (
                <section className="rounded-lg border border-slate-200 bg-white p-6">
                  <ExerciseRunner
                    exercises={exercises}
                    answers={answers}
                    onAnswerChange={handleAnswerChange}
                    onSubmit={handleSubmit}
                    submitting={submitting}
                    submitError={submitError}
                  />
                </section>
              )}
            </>
          )}
        </main>

        {/*
          ============================================================
          AI PANEL — WORKER 14 (frontend/src/components/ai/AiTutorPanel.jsx)
          Đã gắn sẵn bằng React.lazy ở đầu file:
            <AiTutorPanel lesson={lesson} />
          Contract của worker 14: props { lesson: { id, title } | null, className? },
          panel tự render <aside> w-[360px] shrink-0, chat theo ngữ cảnh lesson.id.
          Nếu file panel bị xóa/chưa có, lazy import lỗi sẽ fallback về
          AiPanelPlaceholder — không cần sửa gì thêm ở LessonPage.
          ============================================================
        */}
        <div className="sticky top-6 hidden h-[calc(100vh-7rem)] w-[360px] shrink-0 lg:block">
          <Suspense fallback={<AiPanelPlaceholder />}>
            <AiTutorPanel lesson={lesson} className="rounded-lg border border-slate-200" />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/**
 * Khung dự phòng cho cột AI khi panel của worker 14 chưa sẵn sàng
 * (đang nạp lazy hoặc import lỗi). Giữ nguyên kích thước 360px để
 * bố cục 2 cột không bị nhảy.
 */
function AiPanelPlaceholder() {
  return (
    <div
      className="flex h-full w-[360px] shrink-0 flex-col rounded-lg border border-slate-200 bg-white p-5"
      aria-label="Gia sư AI"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-green-700 text-white">
          <Bot className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">Gia sư AI</p>
          <p className="text-xs text-slate-500">Hỏi đáp theo ngữ cảnh bài học</p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-500">
        Panel trợ giảng cho bài học này đang được tích hợp. Khi hoàn thành, bạn có thể hỏi
        giải thích cho từng câu ngay tại đây mà không rời trang làm bài.
      </p>
    </div>
  );
}

function LessonSkeleton() {
  return (
    <div className="animate-pulse" aria-label="Đang tải bài học">
      <div className="h-8 w-2/3 rounded bg-slate-200" />
      <div className="mt-3 h-4 w-1/2 rounded bg-slate-200" />
      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6">
        <div className="h-4 w-24 rounded bg-slate-200" />
        <div className="mt-5 h-6 w-3/4 rounded bg-slate-200" />
        <div className="mt-6 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-md border border-slate-200 bg-slate-50" />
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ title, message, onBack }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
      <BookOpen className="mx-auto h-8 w-8 text-slate-400" />
      <p className="mt-3 text-sm font-semibold text-slate-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{message}</p>
      <button
        type="button"
        onClick={onBack}
        className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        <ArrowLeft className="h-4 w-4" />
        Quay lại lộ trình
      </button>
    </div>
  );
}

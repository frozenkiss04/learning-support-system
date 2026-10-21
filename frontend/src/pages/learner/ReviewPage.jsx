import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  BookOpen,
  Brain,
  CheckCircle2,
  Layers,
  Loader2,
  MousePointerClick,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { apiGet, apiPost } from "../../lib/api";
import { EmptyState } from "../../components/ui/EmptyState";

const TYPE_LABELS = {
  MULTIPLE_CHOICE: "Trắc nghiệm",
  FILL_BLANK: "Điền từ",
  TRANSLATE: "Dịch câu",
};

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * Ôn tập bằng flashcard theo lịch SRS (SM-2).
 * API: GET  /api/progress/due                       -> [{ id, exercise_id, exercise: {...} }]
 *      POST /api/progress/review/<exercise_id>      -> { is_correct, quality }
 *
 * Lưu ý dữ liệu: thẻ đến hạn chỉ kèm exercise rút gọn (question, options, type)
 * và KHÔNG kèm correct_answer/explanation (backend không trả cho học viên).
 * Mặt sau thẻ hiển thị đáp án khi API có trả; thiếu thì hiện hướng dẫn tự nhớ lại.
 */
export default function ReviewPage() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [knownCount, setKnownCount] = useState(0);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setIndex(0);
    setFlipped(false);
    setKnownCount(0);
    setReviewedCount(0);
    setGradeError("");
    try {
      const data = await apiGet("/api/progress/due");
      setCards(Array.isArray(data) ? data : []);
    } catch (err) {
      setLoadError(
        err?.response?.data?.error?.message ||
          "Không tải được danh sách thẻ ôn tập. Vui lòng thử lại."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const total = cards.length;
  const finished = !loading && !loadError && total > 0 && index >= total;
  const card = !finished && total > 0 ? cards[index] : null;
  const exercise = card?.exercise || {};
  const exerciseId = card?.exercise_id ?? exercise?.id;
  const options = Array.isArray(exercise.options) ? exercise.options : [];
  const question =
    exercise.question || "Nội dung câu hỏi đang được cập nhật.";
  const answer =
    typeof exercise.correct_answer === "string" &&
    exercise.correct_answer.trim()
      ? exercise.correct_answer
      : null;
  const explanation =
    typeof exercise.explanation === "string" && exercise.explanation.trim()
      ? exercise.explanation
      : null;

  const handleGrade = async (known) => {
    if (!card || grading || exerciseId == null) return;
    setGrading(true);
    setGradeError("");
    try {
      await apiPost(`/api/progress/review/${exerciseId}`, {
        is_correct: known,
        quality: known ? 5 : 2,
      });
      if (known) setKnownCount((value) => value + 1);
      setReviewedCount((value) => value + 1);
      setFlipped(false);
      setIndex((value) => value + 1);
    } catch (err) {
      setGradeError(
        err?.response?.data?.error?.message ||
          "Không lưu được kết quả thẻ này. Vui lòng thử lại."
      );
    } finally {
      setGrading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header trang */}
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
          <Brain className="h-5 w-5 text-primary-700" aria-hidden="true" />
          Ôn tập hôm nay
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Các thẻ ghi nhớ đã đến hạn theo lịch ôn tập ngắt quãng. Bấm vào thẻ
          để lật xem đáp án, rồi tự đánh giá mức độ thuộc của bạn.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Đang tải thẻ ôn tập...
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
            onClick={load}
            className="mt-4 rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
          >
            Thử lại
          </button>
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={<Layers className="h-5 w-5" aria-hidden="true" />}
          title="Chưa có thẻ nào đến hạn ôn"
          description="Bạn đã ôn xong mọi thẻ cho hôm nay. Học thêm bài mới để hệ thống tạo thẻ ghi nhớ và nhắc bạn ôn lại đúng lúc."
          action={
            <Link
              to="/learn"
              className="inline-flex items-center gap-2 rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Học bài mới
            </Link>
          }
        />
      ) : finished ? (
        /* Tổng kết phiên ôn */
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary-50">
            <CheckCircle2
              className="h-6 w-6 text-primary-700"
              aria-hidden="true"
            />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">
            Hoàn thành phiên ôn tập
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
            Bạn đã ôn xong các thẻ đến hạn. Các thẻ sẽ quay lại theo lịch ghi
            nhớ dài hạn.
          </p>
          <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xl font-semibold tabular-nums text-slate-900">
                {reviewedCount}
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Thẻ đã ôn
              </p>
            </div>
            <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-3">
              <p className="text-xl font-semibold tabular-nums text-primary-700">
                {knownCount}
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Đã thuộc
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xl font-semibold tabular-nums text-slate-900">
                {reviewedCount - knownCount}
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                Cần ôn lại
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/learn"
              className="inline-flex items-center gap-2 rounded-md bg-primary-700 px-4 py-2 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Về lộ trình học
            </Link>
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Ôn lại
            </button>
          </div>
        </div>
      ) : (
        <div>
          {/* Tiến độ phiên ôn */}
          <div className="mb-4 flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-slate-700">
              Thẻ {index + 1}/{total}
            </p>
            <p className="text-sm text-slate-500">
              Đã thuộc:{" "}
              <span className="font-semibold tabular-nums text-primary-700">
                {knownCount}
              </span>
            </p>
          </div>
          <div
            className="mb-6 h-2 overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={reviewedCount}
            aria-label="Tiến độ phiên ôn tập"
          >
            <div
              className="h-full rounded-full bg-primary-700 transition-all duration-300"
              style={{
                width: `${total ? (reviewedCount / total) * 100 : 0}%`,
              }}
            />
          </div>

          {gradeError && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
              />
              <span>{gradeError}</span>
            </div>
          )}

          {/* Thẻ flashcard lật 3D */}
          <div
            className="[perspective:1200px]"
            role="button"
            tabIndex={0}
            aria-label={flipped ? "Mặt sau thẻ: đáp án" : "Mặt trước thẻ: câu hỏi. Bấm để lật thẻ"}
            onClick={() => setFlipped((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setFlipped((value) => !value);
              }
            }}
          >
            <div
              className="relative h-[380px] w-full transition-transform duration-500 [transform-style:preserve-3d] sm:h-[400px]"
              style={{
                transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
              }}
            >
              {/* Mặt trước */}
              <div className="absolute inset-0 flex flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm [backface-visibility:hidden]">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {TYPE_LABELS[exercise.type] || "Bài tập"}
                  </span>
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Câu hỏi
                  </span>
                </div>
                <p className="mt-5 text-lg font-medium leading-relaxed text-slate-900">
                  {question}
                </p>
                {options.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {options.map((option, optionIndex) => (
                      <li
                        key={optionIndex}
                        className="flex items-start gap-2.5 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                      >
                        <span className="font-semibold text-slate-500">
                          {OPTION_LETTERS[optionIndex] || optionIndex + 1}.
                        </span>
                        <span>{String(option)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-auto flex items-center gap-1.5 pt-4 text-sm text-slate-400">
                  <MousePointerClick
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  Bấm vào thẻ để lật xem đáp án
                </p>
              </div>

              {/* Mặt sau */}
              <div className="absolute inset-0 flex flex-col rounded-lg border border-primary-200 bg-primary-50 p-6 shadow-sm [backface-visibility:hidden] [transform:rotateY(180deg)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center rounded-md border border-primary-200 bg-white px-2.5 py-1 text-xs font-medium text-primary-700">
                    {TYPE_LABELS[exercise.type] || "Bài tập"}
                  </span>
                  <span className="text-xs font-medium uppercase tracking-wide text-primary-700">
                    Đáp án
                  </span>
                </div>
                {answer ? (
                  <>
                    <p className="mt-5 text-lg font-semibold leading-relaxed text-slate-900">
                      {answer}
                    </p>
                    {explanation && (
                      <div className="mt-4 rounded-md border border-primary-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700">
                        <span className="font-medium text-slate-900">
                          Giải thích:{" "}
                        </span>
                        {explanation}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="mt-5 text-base font-medium leading-relaxed text-slate-900">
                      {question}
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">
                      Hãy tự nhớ lại đáp án bạn đã trả lời khi học bài này và
                      đối chiếu với các lựa chọn ở mặt trước, rồi đánh giá
                      trung thực mức độ thuộc của bạn ở bên dưới.
                    </p>
                  </>
                )}
                <p className="mt-auto flex items-center gap-1.5 pt-4 text-sm text-primary-700">
                  <MousePointerClick
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  Bấm vào thẻ để lật lại mặt trước
                </p>
              </div>
            </div>
          </div>

          {/* Tự chấm */}
          {flipped ? (
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={grading}
                onClick={() => handleGrade(false)}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {grading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                )}
                Chưa thuộc
              </button>
              <button
                type="button"
                disabled={grading}
                onClick={() => handleGrade(true)}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {grading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                )}
                Đã thuộc
              </button>
            </div>
          ) : (
            <p className="mt-5 text-center text-sm text-slate-500">
              Lật thẻ để xem đáp án trước khi tự đánh giá.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

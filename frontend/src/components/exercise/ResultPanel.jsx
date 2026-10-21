import { ArrowRight, Award, Check, ListChecks, Map as MapIcon, RotateCcw, X } from "lucide-react";

/**
 * Màn hình kết quả sau khi nộp bài + feedback từng câu.
 * Feedback đúng/sai thể hiện bằng dải phẳng (viền trái + nền nhạt),
 * kèm đáp án đúng và explanation từ BE — không hiệu ứng ăn mừng.
 *
 * Props:
 * - result: { score, passed, correct, total, xp_earned,
 *             details: [{ exercise_id, is_correct, correct_answer, explanation }] }
 * - exercises: danh sách câu hỏi của bài (để hiển thị lại nội dung câu)
 * - answers: { [exerciseId]: string } đáp án học viên đã nộp
 * - onNext(): Học tiếp | onBackToPath(): Quay lại lộ trình | onRetry?(): Làm lại bài
 */
export default function ResultPanel({ result, exercises = [], answers = {}, onNext, onBackToPath, onRetry }) {
  if (!result) return null;

  const detailById = new Map((result.details ?? []).map((d) => [d.exercise_id, d]));
  const sorted = [...exercises].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

  return (
    <div className="flex flex-col gap-6">
      {/* Thẻ tổng kết */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-500">Kết quả bài học</p>
            <p className="mt-1 text-4xl font-bold leading-none text-slate-900">
              {result.score}
              <span className="text-xl font-semibold text-slate-500">%</span>
            </p>
            <span
              className={[
                "mt-3 inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-semibold",
                result.passed
                  ? "border-green-700/30 bg-green-50 text-green-800"
                  : "border-amber-300 bg-amber-50 text-amber-800",
              ].join(" ")}
            >
              {result.passed ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              {result.passed ? "Đạt yêu cầu" : "Chưa đạt — cần từ 80% để hoàn thành bài"}
            </span>
          </div>

          <dl className="flex gap-6 text-right">
            <div>
              <dt className="flex items-center justify-end gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                <ListChecks className="h-3.5 w-3.5" /> Câu đúng
              </dt>
              <dd className="mt-1 text-xl font-semibold text-slate-900">
                {result.correct}/{result.total}
              </dd>
            </div>
            <div>
              <dt className="flex items-center justify-end gap-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                <Award className="h-3.5 w-3.5" /> XP nhận được
              </dt>
              <dd className="mt-1 text-xl font-semibold text-slate-900">+{result.xp_earned ?? 0}</dd>
            </div>
          </dl>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2.5 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={() => onNext?.()}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-green-700 px-5 text-sm font-medium text-white transition-colors hover:bg-green-800"
          >
            Học tiếp
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onBackToPath?.()}
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <MapIcon className="h-4 w-4" />
            Quay lại lộ trình
          </button>
          {onRetry ? (
            <button
              type="button"
              onClick={() => onRetry()}
              className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
            >
              <RotateCcw className="h-4 w-4" />
              Làm lại bài
            </button>
          ) : null}
        </div>
      </section>

      {/* Feedback từng câu */}
      <section aria-label="Nhận xét từng câu">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Nhận xét từng câu
        </h3>
        <div className="flex flex-col gap-3">
          {sorted.map((ex, i) => {
            const detail = detailById.get(ex.id);
            if (!detail) return null;
            const yourAnswer = (answers[ex.id] ?? "").toString();
            return (
              <article
                key={ex.id}
                className={[
                  "rounded-md border border-slate-200 bg-white px-4 py-3.5",
                  detail.is_correct ? "border-l-4 border-l-green-700" : "border-l-4 border-l-red-500",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium leading-6 text-slate-900">
                    Câu {i + 1}. {ex.question}
                  </p>
                  <span
                    className={[
                      "inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold",
                      detail.is_correct ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700",
                    ].join(" ")}
                  >
                    {detail.is_correct ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    {detail.is_correct ? "Đúng" : "Sai"}
                  </span>
                </div>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex gap-2">
                    <dt className="shrink-0 font-medium text-slate-500">Đáp án của bạn:</dt>
                    <dd className={yourAnswer.trim() ? "text-slate-800" : "italic text-slate-400"}>
                      {yourAnswer.trim() || "(bỏ trống)"}
                    </dd>
                  </div>
                  {!detail.is_correct ? (
                    <div className="flex gap-2">
                      <dt className="shrink-0 font-medium text-slate-500">Đáp án đúng:</dt>
                      <dd className="font-medium text-slate-900">{detail.correct_answer}</dd>
                    </div>
                  ) : null}
                </dl>
                {detail.explanation ? (
                  <p className="mt-2 rounded bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
                    {detail.explanation}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

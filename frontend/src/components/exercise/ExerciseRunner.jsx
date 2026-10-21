import { useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, Send } from "lucide-react";
import MultipleChoice from "./MultipleChoice";
import FillBlank from "./FillBlank";
import Translate from "./Translate";

const TYPE_LABELS = {
  MULTIPLE_CHOICE: "Trắc nghiệm",
  FILL_BLANK: "Điền từ",
  MATCHING: "Ghép cặp",
  TRANSLATE: "Dịch câu",
};

/**
 * Trình làm bài: từng câu một, câu hỏi ở giữa trang.
 * Runner chỉ quản lý điều hướng câu; đáp án nằm ở component cha
 * (answers: { [exerciseId]: string }) và chỉ nộp 1 lần qua onSubmit.
 *
 * Props:
 * - exercises: danh sách câu hỏi (đã hoặc chưa sort theo order_index)
 * - answers / onAnswerChange(exerciseId, answer)
 * - onSubmit(): nộp toàn bộ answers
 * - submitting / submitError: trạng thái + thông báo lỗi khi nộp
 * - onProgressChange?(answeredCount, total): cha dùng để vẽ thanh tiến độ mỏng
 */
export default function ExerciseRunner({
  exercises = [],
  answers = {},
  onAnswerChange,
  onSubmit,
  submitting = false,
  submitError = "",
  onProgressChange,
}) {
  const sorted = useMemo(
    () => [...exercises].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
    [exercises],
  );
  const [index, setIndex] = useState(0);
  const total = sorted.length;
  const current = sorted[Math.min(index, Math.max(total - 1, 0))];
  const answeredCount = sorted.filter((ex) => (answers[ex.id] ?? "").toString().trim() !== "").length;
  const isLast = index >= total - 1;
  const currentAnswered = current
    ? (answers[current.id] ?? "").toString().trim() !== ""
    : false;

  const goTo = (next) => {
    const clamped = Math.max(0, Math.min(next, total - 1));
    setIndex(clamped);
    onProgressChange?.(answeredCount, total);
  };

  if (!current) return null;

  const renderExercise = () => {
    const common = {
      exercise: current,
      value: answers[current.id] ?? "",
      onChange: (answer) => onAnswerChange?.(current.id, answer),
      disabled: submitting,
    };
    switch (current.type) {
      case "FILL_BLANK":
        return <FillBlank {...common} />;
      case "TRANSLATE":
        return <Translate {...common} />;
      case "MULTIPLE_CHOICE":
      case "MATCHING":
      default:
        // MATCHING có options thì chọn trong list, không có options thì nhập đáp án.
        return Array.isArray(current.options) && current.options.length > 0 ? (
          <MultipleChoice {...common} />
        ) : (
          <FillBlank {...common} />
        );
    }
  };

  return (
    <div className="flex flex-col">
      {/* Đầu câu hỏi */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-500">
          Câu {index + 1} <span className="text-slate-400">/ {total}</span>
        </span>
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
          {TYPE_LABELS[current.type] ?? "Bài tập"}
        </span>
      </div>

      <h2 className="mb-6 text-lg font-semibold leading-7 text-slate-900">{current.question}</h2>

      {renderExercise()}

      {/* Chỉ số câu hỏi */}
      <div className="mt-8 flex flex-wrap items-center gap-1.5" aria-label="Danh sách câu hỏi">
        {sorted.map((ex, i) => {
          const done = (answers[ex.id] ?? "").toString().trim() !== "";
          return (
            <button
              key={ex.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Đến câu ${i + 1}`}
              className={[
                "h-8 w-8 rounded-md border text-sm font-medium transition-colors",
                i === index
                  ? "border-green-700 bg-green-700 text-white"
                  : done
                    ? "border-green-700/40 bg-green-50 text-green-800 hover:bg-green-100"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              {i + 1}
            </button>
          );
        })}
        <span className="ml-2 text-xs text-slate-500">
          Đã trả lời {answeredCount}/{total} câu
        </span>
      </div>

      {submitError ? (
        <div className="mt-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{submitError}</span>
        </div>
      ) : null}

      {/* Thanh điều hướng / nộp bài — dải phẳng cuối trang */}
      <div className="mt-6 flex items-center justify-between border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          disabled={index === 0 || submitting}
          className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Câu trước
        </button>

        {isLast ? (
          <button
            type="button"
            onClick={() => onSubmit?.()}
            disabled={submitting || answeredCount === 0}
            className="inline-flex h-10 items-center gap-1.5 rounded-md bg-green-700 px-5 text-sm font-medium text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? "Đang nộp bài..." : `Nộp bài (${answeredCount}/${total})`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            disabled={submitting}
            className={[
              "inline-flex h-10 items-center gap-1.5 rounded-md px-5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              currentAnswered
                ? "bg-green-700 text-white hover:bg-green-800"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
            ].join(" ")}
          >
            Câu tiếp theo
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

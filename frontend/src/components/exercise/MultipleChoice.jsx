import { Check } from "lucide-react";

/**
 * Câu hỏi trắc nghiệm (dùng cho cả MATCHING khi có options).
 * Đáp án dạng list chọn dọc, trạng thái selected thể hiện bằng viền + nền
 * xanh lá nhạt và dấu tích — không dùng hiệu ứng gradient/glass.
 *
 * Props:
 * - exercise: { id, question, options: string[] }
 * - value: đáp án đang chọn (string) hoặc ""
 * - onChange(answer: string)
 * - disabled: khóa tương tác (sau khi đã nộp bài)
 */
export default function MultipleChoice({ exercise, value = "", onChange, disabled = false }) {
  const options = Array.isArray(exercise?.options) ? exercise.options : [];

  if (options.length === 0) {
    return (
      <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
        Câu hỏi này chưa có phương án trả lời.
      </p>
    );
  }

  return (
    <div role="radiogroup" aria-label={exercise?.question} className="flex flex-col gap-2">
      {options.map((option, index) => {
        const selected = value === option;
        return (
          <button
            key={`${exercise.id}-${index}`}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange?.(option)}
            className={[
              "flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left text-sm transition-colors",
              selected
                ? "border-green-700 bg-green-50 font-medium text-slate-900"
                : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            ].join(" ")}
          >
            <span
              className={[
                "flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs font-semibold",
                selected
                  ? "border-green-700 bg-green-700 text-white"
                  : "border-slate-300 bg-white text-slate-500",
              ].join(" ")}
            >
              {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : String.fromCharCode(65 + index)}
            </span>
            <span className="min-w-0 flex-1">{option}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Câu hỏi dịch câu.
 * Câu nguồn do ExerciseRunner render ở trên; component này render
 * textarea nhập bản dịch theo chuẩn form doanh nghiệp.
 *
 * Props:
 * - exercise: { id, question }
 * - value: bản dịch đang nhập (string)
 * - onChange(answer: string)
 * - disabled: khóa tương tác (sau khi đã nộp bài)
 */
export default function Translate({ exercise, value = "", onChange, disabled = false }) {
  const inputId = `translate-${exercise?.id}`;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
        Bản dịch của bạn
      </label>
      <textarea
        id={inputId}
        rows={4}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder="Nhập bản dịch đầy đủ của câu trên"
        className="w-full resize-y rounded-md border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:border-green-700 focus:outline-none focus:ring-2 focus:ring-green-700/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60"
      />
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Dịch đủ ý, đúng ngữ pháp. Không phân biệt chữ hoa, chữ thường khi chấm điểm.</span>
        <span>{value.length} ký tự</span>
      </div>
    </div>
  );
}

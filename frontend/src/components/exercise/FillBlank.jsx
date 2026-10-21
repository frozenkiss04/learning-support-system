/**
 * Câu hỏi điền từ vào chỗ trống.
 * Phần câu hỏi (có chứa "___") do ExerciseRunner render ở trên;
 * component này chỉ render ô nhập đáp án theo chuẩn form doanh nghiệp.
 *
 * Props:
 * - exercise: { id, question }
 * - value: đáp án đang nhập (string)
 * - onChange(answer: string)
 * - disabled: khóa tương tác (sau khi đã nộp bài)
 */
export default function FillBlank({ exercise, value = "", onChange, disabled = false }) {
  const inputId = `fill-blank-${exercise?.id}`;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
        Đáp án của bạn
      </label>
      <input
        id={inputId}
        type="text"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder="Điền từ còn thiếu vào chỗ trống"
        className="h-11 w-full rounded-md border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-green-700 focus:outline-none focus:ring-2 focus:ring-green-700/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60"
      />
      <p className="text-xs text-slate-500">Không phân biệt chữ hoa, chữ thường khi chấm điểm.</p>
    </div>
  );
}

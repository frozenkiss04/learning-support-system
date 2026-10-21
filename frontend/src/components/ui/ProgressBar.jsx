const cn = (...parts) => parts.filter(Boolean).join(' ');

const heights = {
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-2.5',
};

/**
 * Thanh tiến độ phẳng, nền slate-200, phần hoàn thành primary-700.
 * Props: value (0-100), max (mặc định 100), size, label (bắt buộc cho a11y
 * nếu không có nhãn nhìn thấy), showValue, className.
 */
export function ProgressBar({
  value = 0,
  max = 100,
  size = 'md',
  label,
  showValue = false,
  className,
  barClassName,
}) {
  const percent = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Tiến độ'}
        className={cn('w-full overflow-hidden rounded-full bg-slate-200', heights[size] ?? heights.md)}
      >
        <div
          className={cn('h-full rounded-full bg-primary-700 transition-[width] duration-700 ease-out', barClassName)}
          style={{ width: `${percent}%` }}
        />
      </div>
      {showValue && (
        <span className="shrink-0 text-xs font-medium tabular-nums text-slate-600">
          {Math.round(percent)}%
        </span>
      )}
    </div>
  );
}

export default ProgressBar;

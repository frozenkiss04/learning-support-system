const cn = (...parts) => parts.filter(Boolean).join(' ');

/**
 * Trạng thái trống chuẩn: viền đứt nét slate-300, nền trắng,
 * icon (Lucide) trong ô slate-100, tiêu đề + mô tả + action tùy chọn.
 * Props: icon (ReactNode), title, description, action / children, className.
 */
export function EmptyState({ icon, title, description, action, className, children }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <div
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-500"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-600">{description}</p>}
      {(action || children) && <div className="mt-4 flex items-center gap-2">{action ?? children}</div>}
    </div>
  );
}

export default EmptyState;

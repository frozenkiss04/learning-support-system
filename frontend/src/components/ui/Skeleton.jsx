const cn = (...parts) => parts.filter(Boolean).join(' ');

/**
 * Khung tải (skeleton) màu slate-200 nhấp nháy nhẹ.
 * variant: rect (mặc định) | text | circle. Có thể dùng nhiều
 * Skeleton xếp chồng để mô phỏng bố cục page khi đang tải.
 */
export function Skeleton({ variant = 'rect', className, ...props }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-slate-200',
        variant === 'circle' && 'rounded-full',
        variant === 'text' && 'h-3.5 rounded',
        variant === 'rect' && 'rounded-md',
        className,
      )}
      {...props}
    />
  );
}

/** Bộ khung cho một thẻ / hàng danh sách — dùng cho trang danh sách. */
export function SkeletonCard({ className }) {
  return (
    <div
      aria-hidden="true"
      className={cn('rounded-lg border border-slate-200 bg-white p-5 shadow-sm', className)}
    >
      <Skeleton variant="text" className="w-1/3" />
      <Skeleton variant="text" className="mt-3 w-full" />
      <Skeleton variant="text" className="mt-2 w-2/3" />
      <Skeleton className="mt-4 h-8 w-24" />
    </div>
  );
}

export default Skeleton;

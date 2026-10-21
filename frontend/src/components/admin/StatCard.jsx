/**
 * StatCard — KPI card phẳng cho khu vực admin.
 * Chuẩn doanh nghiệp: nền trắng, viền slate-200, bo góc 8px, không shadow,
 * không gradient. Icon Lucide trong ô nền slate-100 trung tính.
 */
export default function StatCard({ label, value, caption, icon: Icon, loading = false }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-slate-500">{label}</p>
          {loading ? (
            <div className="mt-2 h-8 w-20 animate-pulse rounded bg-slate-100" aria-label="Đang tải" />
          ) : (
            <p className="mt-1 truncate text-[28px] font-semibold leading-8 text-slate-900">
              {value}
            </p>
          )}
          {caption && !loading ? (
            <p className="mt-1 text-[13px] leading-5 text-slate-500">{caption}</p>
          ) : null}
        </div>
        {Icon ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

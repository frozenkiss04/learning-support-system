/**
 * ActivityChart — khối "Hoạt động làm bài" cho Admin Dashboard.
 *
 * Nguyên tắc: chỉ vẽ từ số liệu API thật, không sinh dữ liệu mẫu.
 * - Nếu /api/admin/stats sau này trả series theo ngày (attempts_by_day /
 *   daily_activity: [{ date|label, attempts|value|count }]) -> vẽ biểu đồ cột
 *   bằng div/CSS, tông slate + primary #15803d (green-700).
 * - Hiện tại BE chưa có series theo ngày -> hiển thị khối "Số liệu tổng quan":
 *   tổng lượt làm + thanh tỉ lệ đúng/sai suy trực tiếp từ accuracy_percent.
 */
import { BarChart3 } from 'lucide-react';

const numberFmt = new Intl.NumberFormat('vi-VN');
const percentFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

function normalizeSeries(stats) {
  const raw = stats?.attempts_by_day || stats?.daily_activity || stats?.activity_by_day;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const points = raw
    .map((item) => ({
      label: item.label || item.date || '',
      value: Number(item.attempts ?? item.value ?? item.count ?? 0),
    }))
    .filter((p) => Number.isFinite(p.value));
  return points.length > 0 ? points : null;
}

function ColumnChart({ points }) {
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <div>
      <div className="flex h-44 items-end gap-2" role="img" aria-label="Biểu đồ lượt làm bài theo ngày">
        {points.map((point, idx) => (
          <div key={`${point.label}-${idx}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-xs font-medium text-slate-600">{numberFmt.format(point.value)}</span>
            <div className="flex h-32 w-full items-end rounded-md bg-slate-50">
              <div
                className="w-full rounded-md bg-green-700"
                style={{ height: `${Math.max((point.value / max) * 100, point.value > 0 ? 4 : 0)}%` }}
                title={`${point.label}: ${numberFmt.format(point.value)} lượt`}
              />
            </div>
            <span className="w-full truncate text-center text-[11px] leading-4 text-slate-500">
              {point.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewBlock({ stats }) {
  const totalAttempts = Number(stats?.total_attempts ?? 0);
  const accuracy = Number(stats?.accuracy_percent ?? 0);

  if (!totalAttempts) {
    return (
      <div className="flex h-44 flex-col items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 text-center">
        <BarChart3 size={22} className="text-slate-400" aria-hidden="true" />
        <p className="mt-2 text-sm text-slate-500">
          Chưa có lượt làm bài nào được ghi nhận trên hệ thống.
        </p>
      </div>
    );
  }

  const wrongPercent = Math.max(0, 100 - accuracy);
  return (
    <div>
      {/* Số liệu tổng quan — thay cho biểu đồ ngày vì BE chưa trả series theo ngày */}
      <dl className="grid grid-cols-2 gap-4">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <dt className="text-[13px] font-medium text-slate-500">Tổng lượt làm bài</dt>
          <dd className="mt-1 text-xl font-semibold text-slate-900">
            {numberFmt.format(totalAttempts)}
          </dd>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <dt className="text-[13px] font-medium text-slate-500">Tỉ lệ trả lời đúng</dt>
          <dd className="mt-1 text-xl font-semibold text-slate-900">
            {percentFmt.format(accuracy)}%
          </dd>
        </div>
      </dl>

      <div className="mt-5">
        <div
          className="flex h-2.5 w-full overflow-hidden rounded-md bg-slate-200"
          role="img"
          aria-label={`Tỉ lệ đúng ${percentFmt.format(accuracy)} phần trăm`}
        >
          <div className="h-full bg-green-700" style={{ width: `${accuracy}%` }} />
        </div>
        <div className="mt-2 flex items-center gap-5 text-[13px] text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-green-700" aria-hidden="true" />
            Đúng {percentFmt.format(accuracy)}%
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-slate-300" aria-hidden="true" />
            Chưa đúng {percentFmt.format(wrongPercent)}%
          </span>
        </div>
      </div>

      <p className="mt-4 border-t border-slate-100 pt-3 text-[13px] leading-5 text-slate-500">
        Biểu đồ theo ngày sẽ hiển thị khi API thống kê bổ sung dữ liệu hoạt động theo ngày.
      </p>
    </div>
  );
}

export default function ActivityChart({ stats, loading = false }) {
  const series = !loading && stats ? normalizeSeries(stats) : null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5" aria-label="Hoạt động làm bài">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-slate-900">Hoạt động làm bài</h2>
        <p className="mt-0.5 text-[13px] text-slate-500">
          {series ? 'Số lượt làm bài theo ngày' : 'Số liệu tổng quan toàn hệ thống'}
        </p>
      </div>
      {loading ? (
        <div className="h-44 animate-pulse rounded-md bg-slate-100" aria-label="Đang tải" />
      ) : series ? (
        <ColumnChart points={series} />
      ) : (
        <OverviewBlock stats={stats} />
      )}
    </section>
  );
}

/**
 * WeakLessonsTable — bảng "Bài học tỉ lệ đúng thấp nhất".
 * Dữ liệu: GET /api/admin/lessons/weakest.
 *
 * LƯU Ý dữ liệu BE hiện tại: endpoint chỉ trả [{ lesson_id, title }] — cột
 * attempts và accuracy đã được tính trong query nhưng chưa được serialize.
 * Component hiển thị "—" cho các cột thiếu và hiện ghi chú rõ ràng,
 * tuyệt đối không tự sinh số liệu. Khi BE bổ sung attempts/accuracy
 * (acc dạng 0..1 hoặc accuracy_percent dạng 0..100 đều nhận), bảng tự đầy đủ.
 */
import { AlertTriangle, Inbox, Info, RotateCcw } from 'lucide-react';

const numberFmt = new Intl.NumberFormat('vi-VN');
const percentFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

function normalizeRow(row, idx) {
  const attemptsRaw = row.attempts ?? row.attempts_count ?? row.total_attempts ?? null;
  const accRaw = row.accuracy_percent ?? row.accuracy ?? row.acc ?? null;
  let accuracy = null;
  if (accRaw !== null && accRaw !== undefined && Number.isFinite(Number(accRaw))) {
    const value = Number(accRaw);
    // avg() của SQL trả 0..1; nếu BE đổi sang phần trăm 0..100 thì giữ nguyên.
    accuracy = value <= 1 ? value * 100 : value;
  }
  return {
    key: row.lesson_id ?? row.id ?? idx,
    lessonId: row.lesson_id ?? row.id ?? null,
    title: row.title || row.name || 'Bài học không tên',
    attempts: attemptsRaw === null ? null : Number(attemptsRaw),
    accuracy,
  };
}

function barColor(accuracy) {
  if (accuracy < 50) return 'bg-red-500';
  if (accuracy < 80) return 'bg-amber-500';
  return 'bg-green-700';
}

function SkeletonRows() {
  return (
    <tbody>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-b border-slate-100 last:border-0">
          <td className="py-3 pr-4" colSpan={4}>
            <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

export default function WeakLessonsTable({ lessons, loading = false, error = null, onRetry }) {
  const rows = Array.isArray(lessons) ? lessons.map(normalizeRow) : [];
  // Bài yếu nhất lên đầu khi có accuracy; thiếu accuracy thì giữ thứ tự BE trả.
  const sorted = [...rows].sort((a, b) => {
    if (a.accuracy === null && b.accuracy === null) return 0;
    if (a.accuracy === null) return 1;
    if (b.accuracy === null) return -1;
    return a.accuracy - b.accuracy;
  });
  const visible = sorted.slice(0, 10);
  const hasMetrics = rows.some((r) => r.attempts !== null || r.accuracy !== null);

  return (
    <section className="rounded-lg border border-slate-200 bg-white" aria-label="Bài học tỉ lệ đúng thấp nhất">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-[15px] font-semibold text-slate-900">Bài học tỉ lệ đúng thấp nhất</h2>
        <p className="mt-0.5 text-[13px] text-slate-500">
          Các bài học cần xem lại nội dung hoặc độ khó.
        </p>
      </div>

      {!loading && !error && visible.length > 0 && !hasMetrics ? (
        <div className="mx-5 mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-5 text-amber-800">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            API hiện chưa trả số lượt làm và tỉ lệ đúng cho từng bài học, nên hai cột này đang để
            trống. Dữ liệu sẽ tự hiển thị khi backend bổ sung hai trường này.
          </span>
        </div>
      ) : null}

      <div className="overflow-x-auto px-5 py-2">
        {error ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <AlertTriangle size={22} className="text-red-500" aria-hidden="true" />
            <p className="mt-2 max-w-md text-sm text-slate-600">{error}</p>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <RotateCcw size={15} aria-hidden="true" />
                Thử lại
              </button>
            ) : null}
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th scope="col" className="py-2.5 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Bài học
                </th>
                <th scope="col" className="w-28 py-2.5 pr-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Lượt làm
                </th>
                <th scope="col" className="w-28 py-2.5 pr-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Tỉ lệ đúng
                </th>
                <th scope="col" className="hidden w-44 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 md:table-cell">
                  Mức độ
                </th>
              </tr>
            </thead>
            {loading ? (
              <SkeletonRows />
            ) : visible.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={4} className="py-10 text-center">
                    <Inbox size={22} className="mx-auto text-slate-400" aria-hidden="true" />
                    <p className="mt-2 text-sm text-slate-500">
                      Chưa có dữ liệu bài học. Bảng sẽ cập nhật khi học viên bắt đầu làm bài.
                    </p>
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody>
                {visible.map((row) => (
                  <tr key={row.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="py-3 pr-4">
                      <span className="font-medium text-slate-900">{row.title}</span>
                      {row.lessonId !== null ? (
                        <span className="ml-2 text-[13px] text-slate-400">#{row.lessonId}</span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-slate-600">
                      {row.attempts === null ? '—' : numberFmt.format(row.attempts)}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums font-medium text-slate-900">
                      {row.accuracy === null ? '—' : `${percentFmt.format(row.accuracy)}%`}
                    </td>
                    <td className="hidden py-3 md:table-cell">
                      {row.accuracy === null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <div
                          className="h-1.5 w-full max-w-[160px] overflow-hidden rounded bg-slate-100"
                          role="img"
                          aria-label={`Tỉ lệ đúng ${percentFmt.format(row.accuracy)} phần trăm`}
                        >
                          <div
                            className={`h-full rounded ${barColor(row.accuracy)}`}
                            style={{ width: `${Math.min(Math.max(row.accuracy, 0), 100)}%` }}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        )}
      </div>
    </section>
  );
}

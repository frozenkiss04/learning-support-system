/**
 * AdminDashboard — trang tổng quan khu vực quản trị.
 *
 * API (qua src/lib/api.js, response đã unwrap `data`):
 * - GET /api/admin/stats            -> { total_learners, total_courses,
 *                                        total_lessons, total_attempts, accuracy_percent }
 * - GET /api/admin/lessons/weakest  -> [{ lesson_id, title, attempts?, accuracy? }]
 *   (BE hiện mới trả lesson_id + title — xem ghi chú trong WeakLessonsTable)
 *
 * Bố cục chuẩn hệ thống nội bộ: header trang + hàng KPI + biểu đồ/tổng quan
 * + bảng bài học yếu. Hai nguồn dữ liệu tải độc lập (Promise.allSettled):
 * lỗi ở khối nào chỉ hiện ở khối đó, kèm nút thử lại. Không số liệu giả.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BookOpen, Layers, RefreshCw, RotateCcw, Target, Users } from 'lucide-react';

import api from '../../lib/api';
import ActivityChart from '../../components/admin/ActivityChart';
import StatCard from '../../components/admin/StatCard';
import WeakLessonsTable from '../../components/admin/WeakLessonsTable';

const numberFmt = new Intl.NumberFormat('vi-VN');
const percentFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

// Phòng thủ: nếu interceptor của api.js chưa unwrap thì tự lấy .data.
function unwrap(res) {
  if (res && typeof res === 'object' && 'success' in res && 'data' in res) return res.data;
  return res;
}

function errorMessage(err, fallback) {
  return err?.response?.data?.error?.message || err?.message || fallback;
}

const initialSection = { loading: true, error: null, data: null };

export default function AdminDashboard() {
  const [statsState, setStatsState] = useState(initialSection);
  const [weakState, setWeakState] = useState(initialSection);

  const loadStats = useCallback(async () => {
    setStatsState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = unwrap(await api.get('/api/admin/stats'));
      setStatsState({ loading: false, error: null, data });
    } catch (err) {
      setStatsState((s) => ({
        ...s,
        loading: false,
        error: errorMessage(err, 'Không tải được số liệu tổng quan. Vui lòng thử lại.'),
      }));
    }
  }, []);

  const loadWeakest = useCallback(async () => {
    setWeakState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = unwrap(await api.get('/api/admin/lessons/weakest'));
      setWeakState({ loading: false, error: null, data: Array.isArray(data) ? data : [] });
    } catch (err) {
      setWeakState((s) => ({
        ...s,
        loading: false,
        error: errorMessage(err, 'Không tải được danh sách bài học yếu. Vui lòng thử lại.'),
      }));
    }
  }, []);

  const loadAll = useCallback(() => {
    loadStats();
    loadWeakest();
  }, [loadStats, loadWeakest]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const stats = statsState.data;
  const refreshing = statsState.loading || weakState.loading;
  const hasAttempts = Number(stats?.total_attempts ?? 0) > 0;

  const kpis = stats
    ? [
        {
          label: 'Tổng học viên',
          value: numberFmt.format(stats.total_learners ?? 0),
          caption: 'Tài khoản vai trò học viên',
          icon: Users,
        },
        {
          label: 'Khóa học',
          value: numberFmt.format(stats.total_courses ?? 0),
          caption: 'Tổng số khóa học trên hệ thống',
          icon: BookOpen,
        },
        {
          label: 'Bài học',
          value: numberFmt.format(stats.total_lessons ?? 0),
          caption: 'Tổng số bài học đã tạo',
          icon: Layers,
        },
        {
          label: 'Tỉ lệ đúng',
          value: hasAttempts ? `${percentFmt.format(stats.accuracy_percent ?? 0)}%` : '—',
          caption: hasAttempts
            ? `Trên ${numberFmt.format(stats.total_attempts)} lượt làm bài`
            : 'Chưa có lượt làm bài nào',
          icon: Target,
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* Header trang */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Tổng quan</h1>
          <p className="mt-1 text-sm text-slate-500">
            Tình hình học tập toàn hệ thống và các bài học cần chú ý.
          </p>
        </div>
        <button
          type="button"
          onClick={loadAll}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : undefined} aria-hidden="true" />
          Làm mới
        </button>
      </div>

      {/* Hàng KPI */}
      {statsState.error && !stats ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-red-200 bg-white px-5 py-10 text-center">
          <AlertTriangle size={22} className="text-red-500" aria-hidden="true" />
          <p className="mt-2 max-w-md text-sm text-slate-600">{statsState.error}</p>
          <button
            type="button"
            onClick={loadStats}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw size={15} aria-hidden="true" />
            Thử lại
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statsState.loading && !stats
            ? Array.from({ length: 4 }).map((_, i) => (
                <StatCard key={i} label="Đang tải" value="" loading />
              ))
            : kpis.map((kpi) => <StatCard key={kpi.label} {...kpi} />)}
        </div>
      )}

      {/* Biểu đồ / tổng quan + bảng bài học yếu */}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <div className="xl:col-span-1">
          {statsState.error && !stats ? (
            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-[15px] font-semibold text-slate-900">Hoạt động làm bài</h2>
              <p className="mt-2 text-sm text-slate-500">
                Chưa hiển thị được do lỗi tải số liệu tổng quan ở trên.
              </p>
            </section>
          ) : (
            <ActivityChart stats={stats} loading={statsState.loading && !stats} />
          )}
        </div>
        <div className="xl:col-span-2">
          <WeakLessonsTable
            lessons={weakState.data}
            loading={weakState.loading && !weakState.data}
            error={weakState.error}
            onRetry={loadWeakest}
          />
        </div>
      </div>
    </div>
  );
}

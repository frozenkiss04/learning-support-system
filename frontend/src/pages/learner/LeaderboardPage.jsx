import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, Medal, Trophy, Users } from "lucide-react";
import { apiGet } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";

function initialsOf(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * Bảng xếp hạng học viên (top 20 theo XP).
 * API: GET /api/leaderboard -> [{ id, full_name, xp }] (đã sort giảm dần theo XP).
 * Dòng của người dùng hiện tại được làm nổi bật bằng nền slate-100.
 */
export default function LeaderboardPage() {
  const currentUser = useAuthStore((state) => state.user);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiGet("/api/leaderboard");
      setEntries(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(
        err?.response?.data?.error?.message ||
          "Không tải được bảng xếp hạng. Vui lòng thử lại."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const isCurrentUser = (entry) =>
    currentUser &&
    (entry.id === currentUser.id ||
      (currentUser.email && entry.email === currentUser.email));

  const myRank = entries.findIndex((entry) => isCurrentUser(entry));

  // Podium hiển thị theo thứ tự cột: hạng 2 — hạng 1 — hạng 3.
  const podiumOrder = [1, 0, 2].filter((i) => entries[i]);
  const rest = entries.slice(3);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Header trang */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Trophy className="h-5 w-5 text-green-700" aria-hidden="true" />
            Bảng xếp hạng
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            20 học viên có điểm kinh nghiệm (XP) cao nhất hệ thống.
          </p>
        </div>
        {myRank >= 0 && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
            Hạng của bạn:{" "}
            <span className="font-semibold text-slate-900">#{myRank + 1}</span>
          </div>
        )}
      </div>

      {/* Bảng xếp hạng */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Đang tải bảng xếp hạng...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <AlertCircle className="h-8 w-8 text-red-500" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-slate-900">
              Đã xảy ra lỗi
            </p>
            <p className="mt-1 max-w-sm text-sm text-slate-600">{error}</p>
            <button
              type="button"
              onClick={load}
              className="mt-4 rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-700 focus-visible:ring-offset-2"
            >
              Thử lại
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <Users className="h-8 w-8 text-slate-400" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-slate-900">
              Chưa có dữ liệu xếp hạng
            </p>
            <p className="mt-1 max-w-sm text-sm text-slate-600">
              Hoàn thành bài học đầu tiên để ghi điểm XP và xuất hiện trên bảng
              xếp hạng.
            </p>
          </div>
        ) : (
          <div>
            {/* Podium top 3 */}
            <div className="flex items-end justify-center gap-4 border-b border-slate-200 px-6 pb-0 pt-8 sm:gap-8">
              {podiumOrder.map((entryIndex) => {
                const entry = entries[entryIndex];
                const rank = entryIndex + 1;
                const mine = isCurrentUser(entry);
                const pedestalHeight =
                  rank === 1 ? "h-20" : rank === 2 ? "h-14" : "h-10";
                return (
                  <div
                    key={entry.id}
                    className="flex w-28 flex-col items-center text-center sm:w-36"
                  >
                    {rank === 1 ? (
                      <Trophy
                        className="h-6 w-6 text-amber-500"
                        aria-label="Hạng nhất"
                      />
                    ) : (
                      <Medal
                        className="h-5 w-5 text-slate-400"
                        aria-label={`Hạng ${rank}`}
                      />
                    )}
                    <div
                      className={`mt-2 flex items-center justify-center rounded-full font-semibold ${
                        rank === 1
                          ? "h-16 w-16 bg-primary-700 text-lg text-white"
                          : "h-12 w-12 bg-slate-200 text-sm text-slate-700"
                      } ${mine ? "ring-2 ring-primary-700 ring-offset-2" : ""}`}
                      aria-hidden="true"
                    >
                      {initialsOf(entry.full_name)}
                    </div>
                    <p className="mt-2 w-full truncate text-sm font-semibold text-slate-900">
                      {entry.full_name}
                      {mine && (
                        <span className="ml-1.5 inline-flex items-center rounded-md border border-slate-300 bg-white px-1.5 py-0.5 align-middle text-xs font-medium text-slate-600">
                          Bạn
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs tabular-nums text-slate-500">
                      {Number(entry.xp || 0).toLocaleString("vi-VN")} XP
                    </p>
                    <div
                      className={`mt-3 flex w-full items-start justify-center rounded-t-lg border border-b-0 border-slate-200 bg-slate-50 pt-2 text-lg font-bold text-slate-400 ${pedestalHeight}`}
                      aria-hidden="true"
                    >
                      {rank}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Hạng 4 trở đi */}
            {rest.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th
                    scope="col"
                    className="w-20 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Hạng
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    Học viên
                  </th>
                  <th
                    scope="col"
                    className="w-32 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500"
                  >
                    XP
                  </th>
                </tr>
              </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rest.map((entry, index) => {
                      const mine = isCurrentUser(entry);
                      return (
                        <tr
                          key={entry.id}
                          className={
                            mine
                              ? "bg-slate-100"
                              : "bg-white hover:bg-slate-50"
                          }
                        >
                          <td className="px-4 py-3">
                            <span className="font-semibold text-slate-900">
                              {index + 4}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={
                                mine
                                  ? "font-semibold text-slate-900"
                                  : "font-medium text-slate-700"
                              }
                            >
                              {entry.full_name}
                            </span>
                            {mine && (
                              <span className="ml-2 inline-flex items-center rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600">
                                Bạn
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                            {Number(entry.xp || 0).toLocaleString("vi-VN")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

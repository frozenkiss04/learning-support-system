/**
 * Loading skeleton for the learning path page: mirrors the real layout
 * (page header + unit blocks with lesson rows) using flat slate blocks.
 */
export default function LearnSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Đang tải lộ trình học">
      {/* Header */}
      <div className="rounded-lg border border-slate-200 bg-white px-5 py-5 sm:px-6">
        <div className="h-3 w-24 rounded bg-slate-200" />
        <div className="mt-3 h-6 w-64 max-w-full rounded bg-slate-200" />
        <div className="mt-2 h-4 w-96 max-w-full rounded bg-slate-100" />
        <div className="mt-5 h-1.5 w-full rounded-full bg-slate-200" />
      </div>

      {/* Unit blocks */}
      {[0, 1].map((block) => (
        <div
          key={block}
          className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="h-3 w-20 rounded bg-slate-200" />
            <div className="mt-2 h-5 w-48 rounded bg-slate-200" />
          </div>
          <div className="divide-y divide-slate-100">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-4 px-5 py-3.5">
                <div className="h-8 w-8 shrink-0 rounded-md bg-slate-200" />
                <div className="flex-1">
                  <div className="h-4 w-56 max-w-full rounded bg-slate-200" />
                  <div className="mt-1.5 h-3 w-32 rounded bg-slate-100" />
                </div>
                <div className="h-5 w-12 shrink-0 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

import { Outlet } from 'react-router-dom'

export default function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 font-sans text-slate-900">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xl font-semibold tracking-tight text-slate-900">
            Learn<span className="text-green-700">Hub</span>
          </p>
          <p className="mt-1 text-sm text-slate-500">Hệ thống hỗ trợ học tập trực tuyến</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <Outlet />
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          © 2026 LearnHub. Mọi quyền được bảo lưu.
        </p>
      </div>
    </div>
  )
}

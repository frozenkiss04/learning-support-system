import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { BookOpen, Flame, LogOut, Trophy, UserRound } from 'lucide-react'

import { readStoredAuth } from '../routes/ProtectedRoute.jsx'
import { useAuthStore } from '../stores/authStore.js'

const MENU = [
  { to: '/learn', label: 'Học tập', icon: BookOpen },
  { to: '/leaderboard', label: 'Bảng xếp hạng', icon: Trophy },
  { to: '/profile', label: 'Hồ sơ', icon: UserRound },
]

function navClass({ isActive }) {
  return [
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
    isActive
      ? 'bg-green-50 font-medium text-green-800'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  ].join(' ')
}

export default function LearnerLayout() {
  const navigate = useNavigate()
  const storeUser = useAuthStore((s) => s.user)
  const storeLogout = useAuthStore((s) => s.logout)
  const { user: storedUser } = readStoredAuth()
  const user = storeUser ?? storedUser

  const xp = user?.xp ?? 0
  const streak = user?.current_streak ?? 0
  const displayName = user?.full_name ?? 'Học viên'
  const initial = displayName.trim().charAt(0).toUpperCase() || 'H'

  function handleLogout() {
    storeLogout()
    try {
      localStorage.removeItem('lss-auth')
      localStorage.removeItem('auth')
    } catch {
      // ignore storage errors on logout
    }
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Sidebar — 240px */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-14 items-center border-b border-slate-200 px-5">
          <span className="text-base font-semibold tracking-tight text-slate-900">
            Learn<span className="text-green-700">Hub</span>
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {MENU.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              <item.icon className="shrink-0" size={18} strokeWidth={1.8} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Streak card */}
        <div className="px-3 pb-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
              <Flame size={16} strokeWidth={1.8} className="text-amber-600" />
              {streak} ngày liên tiếp
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Học ít nhất một bài mỗi ngày để giữ chuỗi.
            </p>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-6">
          <span className="text-base font-semibold tracking-tight md:hidden">
            Learn<span className="text-green-700">Hub</span>
          </span>
          <div className="hidden md:block" />

          <div className="flex items-center gap-2 md:gap-4">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700">
              <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-green-700 text-[10px] font-bold text-white">
                XP
              </span>
              {xp}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-sm font-medium text-slate-700">
              <Flame size={15} strokeWidth={1.8} className="text-amber-600" />
              {streak}
            </span>
            <div className="flex items-center gap-2.5 border-l border-slate-200 pl-2 md:pl-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-700 text-sm font-semibold text-white">
                {initial}
              </span>
              <span className="hidden max-w-40 truncate text-sm font-medium text-slate-800 lg:block">
                {displayName}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                title="Đăng xuất"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <LogOut size={16} strokeWidth={1.8} />
                <span className="hidden lg:inline">Đăng xuất</span>
              </button>
            </div>
          </div>
        </header>

        {/* Mobile menu (sidebar is hidden on small screens) */}
        <nav className="flex gap-1 border-b border-slate-200 bg-white px-3 py-2 md:hidden">
          {MENU.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              <item.icon size={16} strokeWidth={1.8} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

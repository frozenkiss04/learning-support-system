import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  Bot,
  ChevronRight,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Users,
} from 'lucide-react'

import Logo from '../components/brand/Logo.jsx'
import { readStoredAuth } from '../routes/ProtectedRoute.jsx'
import { useAuthStore } from '../stores/authStore.js'

const MENU = [
  { to: '/admin', label: 'Tổng quan', icon: LayoutDashboard, end: true },
  { to: '/admin/courses', label: 'Khóa học', icon: BookOpen },
  { to: '/admin/users', label: 'Học viên', icon: Users },
  { to: '/admin/ai', label: 'Trợ lý AI', icon: Bot },
]

const CRUMB_LABELS = {
  admin: 'Quản trị',
  courses: 'Khóa học',
  users: 'Học viên',
  ai: 'Trợ lý AI',
}

function navClass({ isActive }) {
  return [
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
    isActive
      ? 'bg-slate-800 font-medium text-white'
      : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
  ].join(' ')
}

function Breadcrumb() {
  const { pathname } = useLocation()
  const segments = pathname.split('/').filter(Boolean)
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-slate-500">
      {segments.map((segment, index) => {
        const to = '/' + segments.slice(0, index + 1).join('/')
        const isLast = index === segments.length - 1
        return (
          <span key={to} className="flex items-center gap-1">
            {index > 0 && <ChevronRight size={14} className="text-slate-400" />}
            {isLast ? (
              <span className="font-medium text-slate-800">{CRUMB_LABELS[segment] ?? segment}</span>
            ) : (
              <Link to={to} className="hover:text-slate-800">
                {CRUMB_LABELS[segment] ?? segment}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export default function AdminLayout() {
  const navigate = useNavigate()
  const storeUser = useAuthStore((s) => s.user)
  const storeLogout = useAuthStore((s) => s.logout)
  const { user: storedUser } = readStoredAuth()
  const user = storeUser ?? storedUser
  const displayName = user?.full_name ?? 'Quản trị viên'

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
      {/* Sidebar — 240px, dark slate for the admin area */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-slate-900 md:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-slate-800 px-5">
          {/* Full lockup sits on a white plate: its "Learn" wordmark is
              slate-900 and would be invisible on the dark sidebar. */}
          <span className="inline-flex items-center rounded-md bg-white px-2 py-1">
            <Logo size={20} />
          </span>
          <span className="rounded-sm bg-slate-800 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-300">
            Admin
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {MENU.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
              <item.icon size={18} strokeWidth={1.8} className="shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-800 px-3 py-3">
          <Link
            to="/learn"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/60 hover:text-white"
          >
            <GraduationCap size={18} strokeWidth={1.8} className="shrink-0" />
            Về trang học
          </Link>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-6">
          <Breadcrumb />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:block">
              {displayName}
              <span className="ml-2 rounded-sm bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Admin
              </span>
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
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

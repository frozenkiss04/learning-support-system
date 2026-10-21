import { Navigate, useLocation } from 'react-router-dom'

/**
 * Reads the persisted auth payload (zustand persist key: "lss-auth",
 * legacy fallback "auth") directly from localStorage so routing never
 * depends on store hydration timing.
 * Tolerates both shapes: { state: { user, accessToken } } and { user, accessToken }.
 */
export function readStoredAuth() {
  for (const key of ['lss-auth', 'auth']) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw)
      const state = parsed?.state ?? parsed ?? {}
      if (state.accessToken || state.user) {
        return {
          user: state.user ?? null,
          accessToken: state.accessToken ?? state.token ?? null,
        }
      }
    } catch {
      // try the next key
    }
  }
  return { user: null, accessToken: null }
}

/**
 * ProtectedRoute
 * - No access token  -> redirect to /login (keeps the intended URL in state).
 * - roles given and the user's role is not included -> redirect away:
 *   admins go to /admin, everyone else to /learn.
 */
export default function ProtectedRoute({ children, roles }) {
  const location = useLocation()
  const { user, accessToken } = readStoredAuth()

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  if (roles && roles.length > 0 && !roles.includes(user?.role)) {
    return <Navigate to={user?.role === 'ADMIN' ? '/admin' : '/learn'} replace />
  }

  return children
}

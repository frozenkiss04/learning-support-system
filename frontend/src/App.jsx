import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import AuthLayout from './layouts/AuthLayout.jsx'
import LearnerLayout from './layouts/LearnerLayout.jsx'
import AdminLayout from './layouts/AdminLayout.jsx'
import ProtectedRoute from './routes/ProtectedRoute.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Route-level code splitting: every page is a lazy chunk so the initial
// bundle only carries the app shell (layouts, router, auth guard).
const LoginPage = lazy(() => import('./pages/auth/LoginPage.jsx'))
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage.jsx'))

const LearnPage = lazy(() => import('./pages/learner/LearnPage.jsx'))
const LessonPage = lazy(() => import('./pages/learner/LessonPage.jsx'))
const ReviewPage = lazy(() => import('./pages/learner/ReviewPage.jsx'))
const LeaderboardPage = lazy(() => import('./pages/learner/LeaderboardPage.jsx'))
const ProfilePage = lazy(() => import('./pages/learner/ProfilePage.jsx'))

const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard.jsx'))
const AdminCourses = lazy(() => import('./pages/admin/AdminCourses.jsx'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'))
const AdminAiAssistant = lazy(() => import('./pages/admin/AdminAiAssistant.jsx'))

function PageFallback() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-slate-50">
      <div
        className="h-10 w-10 animate-spin rounded-full border-[3px] border-slate-200 border-t-[#15803d]"
        role="status"
        aria-label="Đang tải"
      />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
    <Routes>
      {/* Public — auth */}
      <Route element={<AuthLayout />}>
        <Route
          path="/login"
          element={
            <Suspense fallback={<PageFallback />}>
              <LoginPage />
            </Suspense>
          }
        />
        <Route
          path="/register"
          element={
            <Suspense fallback={<PageFallback />}>
              <RegisterPage />
            </Suspense>
          }
        />
      </Route>

      {/* Learner area */}
      <Route
        element={
          <ProtectedRoute>
            <LearnerLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/learn" replace />} />
        <Route
          path="/learn"
          element={
            <Suspense fallback={<PageFallback />}>
              <LearnPage />
            </Suspense>
          }
        />
        <Route
          path="/lesson/:lessonId"
          element={
            <Suspense fallback={<PageFallback />}>
              <LessonPage />
            </Suspense>
          }
        />
        <Route
          path="/lessons/:lessonId"
          element={
            <Suspense fallback={<PageFallback />}>
              <LessonPage />
            </Suspense>
          }
        />
        <Route
          path="/review"
          element={
            <Suspense fallback={<PageFallback />}>
              <ReviewPage />
            </Suspense>
          }
        />
        <Route
          path="/leaderboard"
          element={
            <Suspense fallback={<PageFallback />}>
              <LeaderboardPage />
            </Suspense>
          }
        />
        <Route
          path="/profile"
          element={
            <Suspense fallback={<PageFallback />}>
              <ProfilePage />
            </Suspense>
          }
        />
      </Route>

      {/* Admin area — ADMIN role only */}
      <Route
        element={
          <ProtectedRoute roles={['ADMIN']}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route
          path="/admin"
          element={
            <Suspense fallback={<PageFallback />}>
              <AdminDashboard />
            </Suspense>
          }
        />
        <Route
          path="/admin/courses"
          element={
            <Suspense fallback={<PageFallback />}>
              <AdminCourses />
            </Suspense>
          }
        />
        <Route
          path="/admin/users"
          element={
            <Suspense fallback={<PageFallback />}>
              <AdminUsers />
            </Suspense>
          }
        />
        <Route
          path="/admin/ai"
          element={
            <Suspense fallback={<PageFallback />}>
              <AdminAiAssistant />
            </Suspense>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/learn" replace />} />
    </Routes>
    </ErrorBoundary>
  )
}

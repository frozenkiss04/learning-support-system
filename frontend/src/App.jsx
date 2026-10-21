import { Navigate, Route, Routes } from 'react-router-dom'

import AuthLayout from './layouts/AuthLayout.jsx'
import LearnerLayout from './layouts/LearnerLayout.jsx'
import AdminLayout from './layouts/AdminLayout.jsx'
import ProtectedRoute from './routes/ProtectedRoute.jsx'

import LoginPage from './pages/auth/LoginPage.jsx'
import RegisterPage from './pages/auth/RegisterPage.jsx'

import LearnPage from './pages/learner/LearnPage.jsx'
import LessonPage from './pages/learner/LessonPage.jsx'
import LeaderboardPage from './pages/learner/LeaderboardPage.jsx'
import ProfilePage from './pages/learner/ProfilePage.jsx'

import AdminDashboard from './pages/admin/AdminDashboard.jsx'
import AdminCourses from './pages/admin/AdminCourses.jsx'
import AdminUsers from './pages/admin/AdminUsers.jsx'
import AdminAiAssistant from './pages/admin/AdminAiAssistant.jsx'

export default function App() {
  return (
    <Routes>
      {/* Public — auth */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
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
        <Route path="/learn" element={<LearnPage />} />
        <Route path="/lesson/:lessonId" element={<LessonPage />} />
        <Route path="/lessons/:lessonId" element={<LessonPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      {/* Admin area — ADMIN role only */}
      <Route
        element={
          <ProtectedRoute roles={['ADMIN']}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/courses" element={<AdminCourses />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/ai" element={<AdminAiAssistant />} />
      </Route>

      <Route path="*" element={<Navigate to="/learn" replace />} />
    </Routes>
  )
}

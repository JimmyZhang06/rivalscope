import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireAdmin, RequireAuth } from './auth/AuthContext'
import AppLayout from './layouts/AppLayout'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import AccountPage from './pages/app/AccountPage'
import AdminPage from './pages/app/AdminPage'
import DashboardPage from './pages/app/DashboardPage'
import NewResearchPage from './pages/app/NewResearchPage'
import PricingPage from './pages/app/PricingPage'
import TaskDetailPage from './pages/app/TaskDetailPage'
import TasksPage from './pages/app/TasksPage'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* 公开页面 */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* 登录后的工作台 */}
        <Route
          path="/app"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="new" element={<NewResearchPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/:id" element={<TaskDetailPage />} />
          <Route path="pricing" element={<PricingPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route
            path="admin"
            element={
              <RequireAdmin>
                <AdminPage />
              </RequireAdmin>
            }
          />
        </Route>

        {/* 兼容旧链接与未知路径 */}
        <Route path="/tasks/:id" element={<Navigate to="/app/tasks" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

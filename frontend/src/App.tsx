import { Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider, RequireAdmin, RequireAuth } from './auth/AuthContext'
import AppLayout from './layouts/AppLayout'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import AccountPage from './pages/app/AccountPage'
import AdminPage from './pages/app/AdminPage'
import AuditLogsPage from './pages/app/AuditLogsPage'
import AssistantPage from './pages/app/AssistantPage'
import ComparisonPage from './pages/app/ComparisonPage'
import CompetitorsPage from './pages/app/CompetitorsPage'
import DashboardPage from './pages/app/DashboardPage'
import ProfileTemplatesPage from './pages/app/ProfileTemplatesPage'
import ProfilesPage from './pages/app/ProfilesPage'
import ProfileDetailPage from './pages/app/ProfileDetailPage'
import ProfileTasksPage from './pages/app/ProfileTasksPage'
import GraphDetailPage from './pages/app/GraphDetailPage'
import GraphPage from './pages/app/GraphPage'
import NewResearchPage from './pages/app/NewResearchPage'
import PricingPage from './pages/app/PricingPage'
import TaskDetailPage from './pages/app/TaskDetailPage'
import TasksPage from './pages/app/TasksPage'
import TrackerDetailPage from './pages/app/TrackerDetailPage'
import TrackersPage from './pages/app/TrackersPage'

export default function App() {
  return (
    <ErrorBoundary>
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
          <Route path="trackers" element={<TrackersPage />} />
          <Route path="trackers/:id" element={<TrackerDetailPage />} />
          <Route path="competitors" element={<CompetitorsPage />} />
          <Route path="profiles/templates" element={<ProfileTemplatesPage />} />
          <Route path="profiles" element={<ProfilesPage />} />
          <Route path="profiles/:id" element={<ProfileDetailPage />} />
          <Route path="profiles/compare" element={<ComparisonPage />} />
          <Route path="profiles/tasks" element={<ProfileTasksPage />} />
          <Route path="graph" element={<GraphPage />} />
          <Route path="graph/:id" element={<GraphDetailPage />} />
          <Route path="assistant" element={<AssistantPage />} />
          {/* 企业管理已并入个人中心「企业」Tab，保留旧链接重定向 */}
          <Route path="org" element={<Navigate to="/app/account?tab=org" replace />} />
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
          <Route
            path="admin/audit-logs"
            element={
              <RequireAdmin>
                <AuditLogsPage />
              </RequireAdmin>
            }
          />
        </Route>

        {/* 兼容旧链接与未知路径 */}
        <Route path="/tasks/:id" element={<Navigate to="/app/tasks" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
    </ErrorBoundary>
  )
}

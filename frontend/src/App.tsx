import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider, RequireAdmin, RequireAuth } from './auth/AuthContext'
import AppLayout from './layouts/AppLayout'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'

const AccountPage = lazy(() => import('./pages/app/AccountPage'))
const AdminPage = lazy(() => import('./pages/app/AdminPage'))
const AuditLogsPage = lazy(() => import('./pages/app/AuditLogsPage'))
const AssistantPage = lazy(() => import('./pages/app/AssistantPage'))
const AssetsPage = lazy(() => import('./pages/app/AssetsPage'))
const ComparisonPage = lazy(() => import('./pages/app/ComparisonPage'))
const CompetitorsPage = lazy(() => import('./pages/app/CompetitorsPage'))
const DashboardPage = lazy(() => import('./pages/app/DashboardPage'))
const ProfileTemplatesPage = lazy(() => import('./pages/app/ProfileTemplatesPage'))
const ProfilesPage = lazy(() => import('./pages/app/ProfilesPage'))
const ProfileDetailPage = lazy(() => import('./pages/app/ProfileDetailPage'))
const ProfileTasksPage = lazy(() => import('./pages/app/ProfileTasksPage'))
const GraphDetailPage = lazy(() => import('./pages/app/GraphDetailPage'))
const GraphPage = lazy(() => import('./pages/app/GraphPage'))
const IntelligenceEventsPage = lazy(() => import('./pages/app/IntelligenceEventsPage'))
const NewResearchPage = lazy(() => import('./pages/app/NewResearchPage'))
const PricingPage = lazy(() => import('./pages/app/PricingPage'))
const TaskDetailPage = lazy(() => import('./pages/app/TaskDetailPage'))
const TasksPage = lazy(() => import('./pages/app/TasksPage'))
const TrackerDetailPage = lazy(() => import('./pages/app/TrackerDetailPage'))
const TrackersPage = lazy(() => import('./pages/app/TrackersPage'))

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
          <Route path="assets" element={<AssetsPage />} />
          <Route path="new" element={<NewResearchPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/:id" element={<TaskDetailPage />} />
          <Route path="trackers" element={<TrackersPage />} />
          <Route path="trackers/:id" element={<TrackerDetailPage />} />
          <Route path="intelligence" element={<IntelligenceEventsPage />} />
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

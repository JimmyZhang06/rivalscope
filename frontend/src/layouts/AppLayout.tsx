import { Suspense, useCallback, useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { getQuota, getUnreadCount } from '../api/client'
import type { Plan } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import AssistantWidget from '../components/AssistantWidget'
import Sidebar from '../components/layout/Sidebar'
import Topbar from '../components/layout/Topbar'
import { isDemoMode } from '../api/demo'

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [effectivePlan, setEffectivePlan] = useState<Plan | null>(null)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('app-sidebar-collapsed') === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [unreadError, setUnreadError] = useState('')
  const demoMode = isDemoMode()

  const refreshEffectivePlan = useCallback(() => {
    getQuota().then((quota) => setEffectivePlan(quota.plan)).catch(() => {})
  }, [])

  const refreshUnreadCount = useCallback(() => {
    getUnreadCount()
      .then((result) => {
        setUnreadCount(result.count)
        setUnreadError('')
      })
      .catch(() => setUnreadError('未读通知暂时无法加载'))
  }, [])

  useEffect(() => {
    refreshEffectivePlan()
    window.addEventListener('account-plan-updated', refreshEffectivePlan)
    return () => window.removeEventListener('account-plan-updated', refreshEffectivePlan)
  }, [refreshEffectivePlan])

  useEffect(() => {
    refreshUnreadCount()
    const timer = window.setInterval(refreshUnreadCount, 30_000)
    return () => window.clearInterval(timer)
  }, [refreshUnreadCount])

  useEffect(() => {
    localStorage.setItem('app-sidebar-collapsed', String(collapsed))
  }, [collapsed])

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-slate-50 text-gray-900">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        user={user}
        effectivePlan={effectivePlan}
        onCloseMobile={() => setMobileOpen(false)}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
      />
      <div className={`min-h-screen transition-[margin] duration-200 motion-reduce:transition-none ${collapsed ? 'lg:ml-[76px]' : 'lg:ml-64'}`}>
        <Topbar
          unreadCount={unreadCount}
          user={user}
          onOpenMobile={() => setMobileOpen(true)}
          onLogout={handleLogout}
          onRefreshUnread={refreshUnreadCount}
        />
        {demoMode && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-900 sm:px-6">
            演示模式 · 当前显示示例数据，操作不会保存
          </div>
        )}
        <main>
          <Suspense fallback={<div className="p-8 text-center text-sm text-gray-400">加载中…</div>}>
            <Outlet context={{ unreadCount, unreadError, refreshUnreadCount }} />
          </Suspense>
        </main>
        <AssistantWidget />
      </div>
    </div>
  )
}

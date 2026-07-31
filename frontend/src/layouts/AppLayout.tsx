import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Bot,
  Clock,
  FileText,
  Gem,
  LayoutDashboard,
  Network,
  Plus,
  Search,
  Shield,
  User,
} from 'lucide-react'
import { getQuota } from '../api/client'
import type { Plan } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import AssistantWidget from '../components/AssistantWidget'
import NotificationBell from '../components/NotificationBell'
import PlanBadge from '../components/PlanBadge'

const NAV = [
  { to: '/app', label: '仪表盘', icon: LayoutDashboard, end: true },
  { to: '/app/new', label: '新建调研', icon: Plus },
  { to: '/app/tasks', label: '调研记录', icon: FileText },
  { to: '/app/trackers', label: '定时追踪', icon: Clock },
  { to: '/app/graph', label: '关系图谱', icon: Network },
  { to: '/app/assistant', label: 'AI 助手', icon: Bot },
  { to: '/app/pricing', label: '套餐升级', icon: Gem },
  { to: '/app/account', label: '个人中心', icon: User },
]

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  // 侧栏徽章显示实际生效套餐（入企按企业套餐、过期回落），失败时回退个人套餐字段
  const [effectivePlan, setEffectivePlan] = useState<Plan | null>(null)

  useEffect(() => {
    getQuota()
      .then((q) => setEffectivePlan(q.plan))
      .catch(() => {})
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* 侧边栏 */}
      <aside className="fixed inset-y-0 left-0 z-20 flex w-56 flex-col bg-slate-900">
        <NavLink to="/" className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600 text-white">
            <Search className="h-4 w-4" />
          </span>
          <span className="font-bold tracking-tight text-white">竞品调研 Agent</span>
        </NavLink>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
          {user?.role === 'admin' && (
            <NavLink
              to="/app/admin"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Shield className="h-4 w-4 shrink-0" />
              管理后台
            </NavLink>
          )}
        </nav>
        <div className="border-t border-slate-800 p-4">
          <div className="flex items-center gap-3">
            {user?.avatar.startsWith('data:image/') ? (
              <img src={user.avatar} alt="头像" className="h-9 w-9 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                {(user?.nickname || user?.email || '?').slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{user?.nickname || user?.email}</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                {user && <PlanBadge plan={effectivePlan ?? user.plan} />}
                {user?.role === 'admin' && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">管理员</span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="mt-3 w-full rounded-md border border-slate-700 py-1.5 text-xs text-slate-400 transition hover:border-slate-500 hover:bg-slate-800 hover:text-white"
          >
            退出登录
          </button>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="ml-56 flex-1">
        <NotificationBell />
        <Outlet />
        <AssistantWidget />
      </div>
    </div>
  )
}

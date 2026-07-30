import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import PlanBadge from '../components/PlanBadge'

const NAV = [
  { to: '/app', label: '仪表盘', icon: '📈', end: true },
  { to: '/app/new', label: '新建调研', icon: '➕' },
  { to: '/app/tasks', label: '调研记录', icon: '📋' },
  { to: '/app/pricing', label: '套餐升级', icon: '💎' },
  { to: '/app/account', label: '个人中心', icon: '👤' },
]

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* 侧边栏 */}
      <aside className="fixed inset-y-0 left-0 z-20 flex w-56 flex-col border-r border-gray-200 bg-white">
        <NavLink to="/" className="flex items-center gap-2 px-5 py-5">
          <span className="text-xl">🔎</span>
          <span className="font-bold text-gray-900">竞品调研 Agent</span>
        </NavLink>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
          {user?.role === 'admin' && (
            <NavLink
              to="/app/admin"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <span>🛡️</span>
              管理后台
            </NavLink>
          )}
        </nav>
        <div className="border-t border-gray-100 p-4">
          <div className="flex items-center gap-3">
            {user?.avatar.startsWith('data:image/') ? (
              <img src={user.avatar} alt="头像" className="h-9 w-9 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                {(user?.nickname || user?.email || '?').slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{user?.nickname || user?.email}</p>
              <div className="mt-0.5 flex items-center gap-1.5">
                {user && <PlanBadge plan={user.plan} />}
                {user?.role === 'admin' && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">管理员</span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="mt-3 w-full rounded-lg border border-gray-200 py-1.5 text-xs text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700"
          >
            退出登录
          </button>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="ml-56 flex-1">
        <Outlet />
      </div>
    </div>
  )
}

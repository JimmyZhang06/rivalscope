import { useCallback, useEffect, useState } from 'react'
import { adminListUsers, adminStats, adminUpdateUser } from '../../api/client'
import type { AdminStats, Plan, Role, User } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import PlanBadge from '../../components/PlanBadge'

const PLAN_NAMES: Record<Plan, string> = { free: '免费版', pro: '专业版', enterprise: '企业版' }

export default function AdminPage() {
  const { user: me, refreshUser } = useAuth()
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [q, setQ] = useState('')
  const [message, setMessage] = useState('')

  const loadUsers = useCallback((keyword: string) => {
    adminListUsers(keyword).then(setUsers).catch(() => {})
  }, [])

  useEffect(() => {
    adminStats().then(setStats).catch(() => {})
    loadUsers('')
  }, [loadUsers])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    loadUsers(q.trim())
  }

  const handlePlanChange = async (u: User, plan: Plan) => {
    if (plan === u.plan) return
    try {
      await adminUpdateUser(u.id, { plan })
      setMessage(`已将 ${u.nickname || u.email} 的套餐调整为${PLAN_NAMES[plan]}`)
      loadUsers(q.trim())
      adminStats().then(setStats).catch(() => {})
      if (u.id === me?.id) refreshUser()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '调整失败')
    }
  }

  const handleRoleChange = async (u: User, role: Role) => {
    if (role === u.role) return
    try {
      await adminUpdateUser(u.id, { role })
      setMessage(`已将 ${u.nickname || u.email} 的角色调整为${role === 'admin' ? '管理员' : '普通用户'}`)
      loadUsers(q.trim())
      if (u.id === me?.id) refreshUser()
    } catch (err) {
      // 后端约束：不能取消自己的管理员权限
      setMessage(err instanceof Error ? err.message : '调整失败')
      loadUsers(q.trim())
    }
  }

  const STAT_CARDS = stats
    ? [
        { label: '总用户数', value: stats.total_users, icon: '👥' },
        { label: '付费用户', value: stats.paid_users, icon: '💎' },
        { label: '累计收入', value: `¥${stats.total_revenue}`, icon: '💰' },
        { label: '总调研任务', value: stats.total_tasks, icon: '📋' },
        { label: '本月任务', value: stats.tasks_this_month, icon: '📈' },
      ]
    : []

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900">管理后台</h1>
      <p className="mt-1 text-sm text-gray-500">平台运营数据与用户管理</p>

      {/* 统计卡片 */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {STAT_CARDS.map((s) => (
          <div key={s.label} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-gray-500">
              {s.icon} {s.label}
            </p>
            <p className="mt-2 text-2xl font-bold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* 用户管理 */}
      <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900">用户管理</h2>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索邮箱或昵称"
              className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              搜索
            </button>
          </form>
        </div>

        {message && (
          <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</p>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400">
                <th className="pb-2 font-medium">用户</th>
                <th className="pb-2 font-medium">角色</th>
                <th className="pb-2 font-medium">套餐</th>
                <th className="pb-2 font-medium">套餐到期</th>
                <th className="pb-2 font-medium">注册时间</th>
                <th className="pb-2 font-medium">调整套餐</th>
                <th className="pb-2 font-medium">调整角色</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-3">
                    <p className="font-medium text-gray-900">{u.nickname || '—'}</p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                  </td>
                  <td className="py-3">
                    {u.role === 'admin' ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                        管理员
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">用户</span>
                    )}
                  </td>
                  <td className="py-3">
                    <PlanBadge plan={u.plan} />
                  </td>
                  <td className="py-3 text-xs text-gray-500">
                    {u.plan_expires_at ? new Date(u.plan_expires_at).toLocaleDateString('zh-CN') : '—'}
                  </td>
                  <td className="py-3 text-xs text-gray-500">
                    {new Date(u.created_at).toLocaleDateString('zh-CN')}
                  </td>
                  <td className="py-3">
                    <select
                      value={u.plan}
                      onChange={(e) => handlePlanChange(u, e.target.value as Plan)}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                    >
                      <option value="free">免费版</option>
                      <option value="pro">专业版</option>
                      <option value="enterprise">企业版</option>
                    </select>
                  </td>
                  <td className="py-3">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u, e.target.value as Role)}
                      disabled={u.id === me?.id}
                      title={u.id === me?.id ? '不能调整自己的管理员权限' : undefined}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                    >
                      <option value="user">普通用户</option>
                      <option value="admin">管理员</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">未找到匹配的用户</p>
          )}
        </div>
      </section>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Gem, TrendingUp, Users, Wallet } from 'lucide-react'
import { adminListOrgs, adminListUsers, adminStats, adminUpdateOrg, adminUpdateUser } from '../../api/client'
import type { AdminOrg, AdminOrgListResponse, AdminStats, AdminUserListResponse, Plan, Role, User } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import PlanBadge from '../../components/PlanBadge'

const PLAN_NAMES: Record<Plan, string> = { free: '免费版', pro: '专业版', enterprise: '企业版' }

function Pagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  const pages: (number | '...')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('...')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
      <span>共 {total} 条</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(page - 1)} disabled={page <= 1} className="rounded border border-gray-200 px-2 py-1 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">上一页</button>
        {pages.map((p, i) => (
          p === '...'
            ? <span key={`e${i}`} className="px-1">…</span>
            : <button key={p} onClick={() => onChange(p)} className={`rounded border px-2.5 py-1 ${p === page ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 hover:bg-gray-50'}`}>{p}</button>
        ))}
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages} className="rounded border border-gray-200 px-2 py-1 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">下一页</button>
      </div>
    </div>
  )
}

export default function AdminPage() {
  const { user: me, refreshUser } = useAuth()
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [orgs, setOrgs] = useState<AdminOrg[]>([])
  const [userTotal, setUserTotal] = useState(0)
  const [orgTotal, setOrgTotal] = useState(0)
  const [userPage, setUserPage] = useState(1)
  const [orgPage, setOrgPage] = useState(1)
  const PAGE_SIZE = 20
  const [q, setQ] = useState('')
  const [orgQ, setOrgQ] = useState('')
  const [message, setMessage] = useState('')
  const [orgMessage, setOrgMessage] = useState('')

  const loadUsers = useCallback((keyword: string, page = 1) => {
    adminListUsers(keyword, page, PAGE_SIZE).then((r) => {
      setUsers(r.items)
      setUserTotal(r.total)
      setUserPage(r.page)
    }).catch(() => {})
  }, [])

  const loadOrgs = useCallback((keyword: string, page = 1) => {
    adminListOrgs(keyword, page, PAGE_SIZE).then((r) => {
      setOrgs(r.items)
      setOrgTotal(r.total)
      setOrgPage(r.page)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    adminStats().then(setStats).catch(() => {})
    loadUsers('', 1)
    loadOrgs('', 1)
  }, [loadUsers, loadOrgs])

  const totalUserPages = Math.max(1, Math.ceil(userTotal / PAGE_SIZE))
  const totalOrgPages = Math.max(1, Math.ceil(orgTotal / PAGE_SIZE))

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    loadUsers(q.trim(), 1)
  }

  const handleOrgSearch = (e: React.FormEvent) => {
    e.preventDefault()
    loadOrgs(orgQ.trim(), 1)
  }

  const handlePlanChange = async (u: User, plan: Plan) => {
    if (plan === u.plan) return
    try {
      await adminUpdateUser(u.id, { plan })
      setMessage(`已将 ${u.nickname || u.email} 的套餐调整为${PLAN_NAMES[plan]}`)
      loadUsers(q.trim(), userPage)
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
      loadUsers(q.trim(), userPage)
      if (u.id === me?.id) refreshUser()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '调整失败')
      loadUsers(q.trim(), userPage)
    }
  }

  const handleOrgPlanChange = async (o: AdminOrg, plan: Plan) => {
    if (plan === o.plan) return
    try {
      await adminUpdateOrg(o.id, { plan })
      setOrgMessage(`已将企业「${o.name}」的套餐调整为${PLAN_NAMES[plan]}`)
      loadOrgs(orgQ.trim(), orgPage)
    } catch (err) {
      setOrgMessage(err instanceof Error ? err.message : '调整失败')
    }
  }

  const STAT_CARDS = stats
    ? [
        { label: '总用户数', value: stats.total_users, icon: Users },
        { label: '付费用户', value: stats.paid_users, icon: Gem },
        { label: '累计收入', value: `¥${stats.total_revenue}`, icon: Wallet },
        { label: '总调研任务', value: stats.total_tasks, icon: ClipboardList },
        { label: '本月任务', value: stats.tasks_this_month, icon: TrendingUp },
      ]
    : []

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">管理后台</h1>
      <p className="mt-1 text-sm text-gray-500">平台运营数据与用户管理</p>

      {/* 统计卡片 */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {STAT_CARDS.map((s) => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">{s.label}</p>
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-50 text-gray-400">
                <s.icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* 用户管理 */}
      <section className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900">用户管理</h2>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索邮箱或昵称"
              className="w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              搜索
            </button>
          </form>
        </div>

        {message && (
          <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</p>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
                <th className="px-3 py-2 font-medium">用户</th>
                <th className="px-3 py-2 font-medium">角色</th>
                <th className="px-3 py-2 font-medium">套餐</th>
                <th className="px-3 py-2 font-medium">套餐到期</th>
                <th className="px-3 py-2 font-medium">注册时间</th>
                <th className="px-3 py-2 font-medium">调整套餐</th>
                <th className="px-3 py-2 font-medium">调整角色</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-3">
                    <p className="font-medium text-gray-900">{u.nickname || '—'}</p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                  </td>
                  <td className="px-3 py-3">
                    {u.role === 'admin' ? (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                        管理员
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">用户</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <PlanBadge plan={u.plan} />
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {u.plan_expires_at ? new Date(u.plan_expires_at).toLocaleDateString('zh-CN') : '—'}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {new Date(u.created_at).toLocaleDateString('zh-CN')}
                  </td>
                  <td className="px-3 py-3">
                    <select
                      value={u.plan}
                      onChange={(e) => handlePlanChange(u, e.target.value as Plan)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                    >
                      <option value="free">免费版</option>
                      <option value="pro">专业版</option>
                      <option value="enterprise">企业版</option>
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u, e.target.value as Role)}
                      disabled={u.id === me?.id}
                      title={u.id === me?.id ? '不能调整自己的管理员权限' : undefined}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
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
          <Pagination page={userPage} totalPages={totalUserPages} total={userTotal} onChange={(p) => loadUsers(q.trim(), p)} />
        </div>
      </section>

      {/* 企业管理 */}
      <section className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900">企业管理</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              loadOrgs(orgQ.trim())
            }}
            className="flex gap-2"
          >
            <input
              value={orgQ}
              onChange={(e) => setOrgQ(e.target.value)}
              placeholder="搜索企业名称"
              className="w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700"
            >
              搜索
            </button>
          </form>
        </div>

        {orgMessage && (
          <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">{orgMessage}</p>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
                <th className="px-3 py-2 font-medium">企业</th>
                <th className="px-3 py-2 font-medium">套餐</th>
                <th className="px-3 py-2 font-medium">套餐到期</th>
                <th className="px-3 py-2 font-medium">成员数</th>
                <th className="px-3 py-2 font-medium">本月用量</th>
                <th className="px-3 py-2 font-medium">创建时间</th>
                <th className="px-3 py-2 font-medium">调整套餐</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-3">
                    <p className="font-medium text-gray-900">{o.name}</p>
                    <p className="text-xs text-gray-500">邀请码 {o.invite_code}</p>
                  </td>
                  <td className="px-3 py-3">
                    <PlanBadge plan={o.plan} />
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {o.plan_expires_at ? new Date(o.plan_expires_at).toLocaleDateString('zh-CN') : '—'}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-500">{o.member_count}</td>
                  <td className="px-3 py-3 text-xs text-gray-500">{o.month_used} 次</td>
                  <td className="px-3 py-3 text-xs text-gray-500">
                    {new Date(o.created_at).toLocaleDateString('zh-CN')}
                  </td>
                  <td className="px-3 py-3">
                    <select
                      value={o.plan}
                      onChange={(e) => handleOrgPlanChange(o, e.target.value as Plan)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
                    >
                      <option value="free">免费版</option>
                      <option value="pro">专业版</option>
                      <option value="enterprise">企业版</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orgs.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">未找到匹配的企业</p>
          )}
          <Pagination page={orgPage} totalPages={totalOrgPages} total={orgTotal} onChange={(p) => loadOrgs(orgQ.trim(), p)} />
        </div>
      </section>
    </div>
  )
}

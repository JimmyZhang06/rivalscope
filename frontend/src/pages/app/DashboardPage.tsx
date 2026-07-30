import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getQuota, listResearch } from '../../api/client'
import type { Quota, TaskBrief } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import StatusBadge from '../../components/StatusBadge'

export default function DashboardPage() {
  const { user } = useAuth()
  const [quota, setQuota] = useState<Quota | null>(null)
  const [tasks, setTasks] = useState<TaskBrief[]>([])

  useEffect(() => {
    getQuota().then(setQuota).catch(() => {})
    listResearch().then(setTasks).catch(() => {})
  }, [])

  const unlimited = quota?.limit === -1
  const percent = quota && !unlimited && quota.limit > 0 ? Math.min(100, (quota.used / quota.limit) * 100) : 0
  const completed = tasks.filter((t) => t.status === 'completed').length
  const running = tasks.filter((t) => !['completed', 'failed'].includes(t.status)).length

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">你好，{user?.nickname || '朋友'} 👋</h1>
          <p className="mt-1 text-sm text-gray-500">欢迎回到竞品调研工作台</p>
        </div>
        <Link
          to="/app/new"
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          ＋ 新建调研
        </Link>
      </div>

      {/* 统计卡片 */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">当前套餐</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{quota?.plan_name ?? '—'}</p>
          <Link to="/app/pricing" className="mt-1 inline-block text-xs text-blue-600 hover:underline">
            查看升级选项 →
          </Link>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">本月额度</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">
            {quota ? (unlimited ? `${quota.used} / 不限` : `${quota.used} / ${quota.limit}`) : '—'}
          </p>
          {quota && !unlimited && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full ${percent >= 100 ? 'bg-red-500' : 'bg-blue-600'}`}
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          {unlimited && <p className="mt-1 text-xs text-emerald-600">企业版不限次数</p>}
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">已完成调研</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{completed}</p>
          <p className="mt-1 text-xs text-gray-400">共 {tasks.length} 个任务</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">进行中</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{running}</p>
          <p className="mt-1 text-xs text-gray-400">检索关键词 {quota?.max_queries ?? '—'} 组/次</p>
        </div>
      </div>

      {/* 最近任务 */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">最近调研</h2>
          <Link to="/app/tasks" className="text-sm text-blue-600 hover:underline">
            查看全部 →
          </Link>
        </div>
        {tasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 py-12 text-center">
            <p className="text-sm text-gray-400">还没有调研任务</p>
            <Link to="/app/new" className="mt-2 inline-block text-sm text-blue-600 hover:underline">
              发起第一次调研 →
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {tasks.slice(0, 5).map((t) => (
              <li key={t.id}>
                <Link
                  to={`/app/tasks/${t.id}`}
                  className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-gray-900">{t.product_name}</span>
                      <StatusBadge status={t.status} />
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-500">
                      {t.competitors && <>竞品：{t.competitors} · </>}
                      {new Date(t.created_at).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <span className="text-gray-300">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

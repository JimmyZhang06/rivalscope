import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock,
  FileText,
  LoaderCircle,
  RefreshCw,
  User,
  Target,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { listResearch, listTrackers, listProfiles, getUnreadCount } from '../../api/client'
import type { TaskBrief, Tracker, CompetitorProfile } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import StatusBadge from '../../components/StatusBadge'
import { CardSkeleton, ListSkeleton } from '../../components/Skeleton'
import { fmtDateTime } from '../../utils/time'
import { usePageTitle } from '../../hooks/usePageTitle'

const TASK_STATUS_META: Record<string, { label: string; color: string }> = {
  pending:    { label: '等待中', color: '#9ca3af' },
  planning:   { label: '规划中', color: '#6366f1' },
  searching:  { label: '检索中', color: '#06b6d4' },
  analyzing:  { label: '分析中', color: '#f59e0b' },
  reporting:  { label: '生成中', color: '#3b82f6' },
  completed:  { label: '已完成', color: '#10b981' },
  failed:     { label: '失败',   color: '#ef4444' },
}

export default function DashboardPage() {
  const { user } = useAuth()
  usePageTitle('工作台')

  const [tasks, setTasks] = useState<TaskBrief[]>([])
  const [profiles, setProfiles] = useState<CompetitorProfile[]>([])
  const [trackers, setTrackers] = useState<Tracker[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)

  const fetchAll = useCallback(async () => {
    setError(null)
    let hasCriticalError = false
    try {
      const [tasksData, profilesData] = await Promise.all([
        listResearch(),
        listProfiles(),
      ])
      setTasks(tasksData)
      setProfiles(profilesData)
    } catch (e) {
      console.warn('核心数据加载失败:', e)
      hasCriticalError = true
    }
    // 追踪项（非企业用户会 403，静默忽略）
    listTrackers()
      .then(setTrackers)
      .catch(() => {})
    // 未读通知数
    getUnreadCount()
      .then((r: { count: number }) => setUnreadCount(r.count))
      .catch(() => {})
    setLoading(false)
    if (hasCriticalError) {
      setError('核心数据加载失败，请检查网络后重试')
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  // 30 秒定期刷新
  useEffect(() => {
    const timer = setInterval(fetchAll, 30_000)
    return () => clearInterval(timer)
  }, [fetchAll])

  // 未读通知数单独刷新（与通知铃铛同步）
  useEffect(() => {
    getUnreadCount()
      .then((r: { count: number }) => setUnreadCount(r.count))
      .catch(() => {})
  }, [fetchAll])

  const handleRetry = async () => {
    setRetrying(true)
    await fetchAll()
    setRetrying(false)
  }

  // ---- 计算 ----
  const completed = tasks.filter((t) => t.status === 'completed').length
  const running = tasks.filter((t) => !['completed', 'failed'].includes(t.status)).length
  const profileCount = profiles.length
  const trackerCount = trackers.length
  const frozenCount = profiles.filter((p) => p.status === 'frozen').length
  const draftCount = profiles.filter((p) => p.status === 'draft').length

  const activeTrackers = trackers.filter((t) => t.enabled).slice(0, 5)

  // 任务状态分布
  const statusCounts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1
    return acc
  }, {})
  const statusDistribution = Object.entries(TASK_STATUS_META)
    .filter(([key]) => (statusCounts[key] || 0) > 0)
    .map(([key, meta]) => ({
      name: meta.label,
      value: statusCounts[key] || 0,
      color: meta.color,
    }))

  // ---- 渲染 ----
  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <CardSkeleton />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="mt-8">
          <ListSkeleton count={3} />
        </div>
      </div>
    )
  }

  if (error && tasks.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? '重试中…' : '重新加载'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {/* 欢迎栏 + 快捷操作 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">你好，{user?.nickname || '朋友'}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {unreadCount > 0
              ? `你有 ${unreadCount} 条未读通知`
              : '欢迎回到竞品调研工作台'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/app/new"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            ＋ 新建调研
          </Link>
          <Link
            to="/app/trackers"
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50"
          >
            <Clock className="inline-block h-4 w-4 -mt-0.5 mr-1" />
            追踪
          </Link>
          <Link
            to="/app/competitors"
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50"
          >
            竞品管理
          </Link>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<FileText className="h-4 w-4" />}
          label="已完成调研"
          value={String(completed)}
          subtitle={`共 ${tasks.length} 个任务`}
        />
        <StatCard
          icon={<LoaderCircle className="h-4 w-4" />}
          label="进行中"
          value={String(running)}
        />
        <StatCard
          icon={<Target className="h-4 w-4" />}
          label="画像数量"
          value={String(profileCount)}
          subtitle={`${frozenCount} 已冻结 · ${draftCount} 草稿`}
          link="/app/profiles"
          linkLabel="管理画像 →"
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="追踪数量"
          value={String(trackerCount)}
          subtitle={`${trackers.filter((t) => t.enabled).length} 个已启用`}
          link="/app/trackers"
          linkLabel="管理追踪 →"
        />
      </div>

      {/* 图表区：画像状态 + 任务状态分布 */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* 画像板块 */}
        <div className="lg:col-span-2 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-50 text-indigo-700">
                <Target className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">画像</h3>
                <p className="text-xs text-gray-400">共 {profileCount} 个画像 · {frozenCount} 已冻结 · {draftCount} 草稿</p>
              </div>
            </div>
            <Link to="/app/profiles" className="text-xs text-blue-600 hover:underline">
              管理画像 →
            </Link>
          </div>

          {/* 最近画像列表 */}
          <div className="mt-4">
            {profiles.length > 0 ? (
              <ul className="space-y-2">
                {profiles.slice(0, 5).map((p) => {
                  const statusMeta = p.status === 'frozen'
                    ? { label: '已冻结', cls: 'bg-emerald-50 text-emerald-700' }
                    : p.status === 'reviewed'
                      ? { label: '已审核', cls: 'bg-blue-50 text-blue-700' }
                      : { label: '草稿', cls: 'bg-amber-50 text-amber-700' }
                  const summary = typeof p.profile_data === 'object' && p.profile_data?.summary
                    ? (typeof p.profile_data.summary === 'string' ? p.profile_data.summary : (p.profile_data.summary as any)?.key_points?.[0] || '')
                    : ''
                  return (
                    <li key={p.id}>
                      <Link
                        to={`/app/profiles/${p.id}`}
                        className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-2.5 transition hover:border-indigo-200 hover:bg-indigo-50/30"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-gray-800">
                              竞品 ID：{p.competitor_id.slice(0, 8)}
                            </span>
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusMeta.cls}`}>
                              {statusMeta.label}
                            </span>
                          </div>
                          {summary && (
                            <p className="mt-0.5 truncate text-xs text-gray-500">{String(summary).slice(0, 60)}</p>
                          )}
                        </div>
                        <span className="text-xs text-gray-400">{p.source_refs?.length || 0} 来源</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="flex flex-col items-center justify-center py-8">
                <p className="text-sm text-gray-400">还没有画像</p>
                <Link to="/app/profiles" className="mt-2 text-sm text-blue-600 hover:underline">
                  去生成画像 →
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* 任务状态分布 */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-purple-50 text-purple-700">
              <FileText className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">任务状态分布</h3>
              <p className="text-xs text-gray-400">共 {tasks.length} 个任务</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-center">
            {statusDistribution.length > 0 ? (
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusDistribution}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={80}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {statusDistribution.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: unknown, name: unknown) => [`${value as number} 个`, name as string]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap justify-center gap-3">
                  {statusDistribution.map((entry) => (
                    <span key={entry.name} className="flex items-center gap-1.5 text-xs text-gray-600">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                      {entry.name} {entry.value}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-52 flex items-center justify-center text-sm text-gray-400">
                暂无任务
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 追踪项状态预览 */}
      {activeTrackers.length > 0 && (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              <Clock className="inline-block mr-1.5 h-5 w-5 -mt-0.5 text-gray-400" />
              活跃追踪
            </h2>
            <Link to="/app/trackers" className="text-sm text-blue-600 hover:underline">
              管理追踪 →
            </Link>
          </div>
          <ul className="space-y-2">
            {activeTrackers.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-gray-900">{t.product_name}</span>
                    {t.running ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-xs text-cyan-700">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500" />
                        执行中
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                        {t.frequency === 'daily' ? '每日' : t.frequency === 'weekly' ? '每周' : '每月'}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-gray-500">
                    {t.competitors && <>竞品：{t.competitors} · </>}
                    {t.next_run_at ? `下次运行：${fmtDateTime(t.next_run_at)}` : '已启用'}
                  </p>
                </div>
                <Link
                  to={`/app/trackers/${t.id}`}
                  className="text-sm font-medium text-blue-700 hover:underline"
                >
                  查看 →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 最近任务 */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">最近调研</h2>
          <Link to="/app/tasks" className="text-sm text-blue-600 hover:underline">
            查看全部 →
          </Link>
        </div>
        {tasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
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
                  className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-gray-900">{t.product_name}</span>
                      <StatusBadge status={t.status} />
                      {t.creator_nickname && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-xs text-cyan-800">
                          <User className="h-3 w-3" /> {t.creator_nickname}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-500">
                      {t.competitors && <>竞品：{t.competitors} · </>}
                      {fmtDateTime(t.created_at)}
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

// ---- 子组件 ----

function StatCard({
  icon,
  label,
  value,
  subtitle,
  progress,
  memberInfo,
  link,
  linkLabel,
}: {
  icon: React.ReactNode
  label: string
  value: string
  subtitle?: string
  progress?: { percent: number; unlimited: boolean }
  memberInfo?: string
  link?: string
  linkLabel?: string
}) {
  const content = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-50 text-gray-400">
          {icon}
        </span>
      </div>
      <p className="mt-1 text-2xl font-bold tracking-tight text-gray-900">{value}</p>
      {progress && !progress.unlimited && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full transition-all ${progress.percent >= 100 ? 'bg-red-500' : 'bg-blue-600'}`}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}
      {progress && progress.unlimited && (
        <p className="mt-1 text-xs text-emerald-600">企业版不限次数</p>
      )}
      {subtitle && <p className="mt-1 text-xs text-gray-400">{subtitle}</p>}
      {memberInfo && <p className="mt-1 text-xs text-blue-500">{memberInfo}</p>}
      {link && linkLabel && (
        <a href={link} className="mt-1 inline-block text-xs text-blue-600 hover:underline">
          {linkLabel}
        </a>
      )}
    </>
  )

  if (link) {
    return (
      <Link to={link} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:border-gray-300">
        {content}
      </Link>
    )
  }
  return <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">{content}</div>
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CheckCircle2,
  Clock3,
  FileSearch,
  Network,
  RadioTower,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  getIntelligenceEventSummary,
  listAssets,
  listIntelligenceEvents,
  listTrackers,
} from '../../api/client'
import type {
  IntelligenceEvent,
  IntelligenceEventStatus,
  IntelligenceEventSummary,
  IntelligenceEventType,
  IntelligenceObject,
  IntelligenceObjectType,
  Tracker,
} from '../../api/types'
import { useAppLayoutContext } from '../../components/layout/AppLayoutContext'
import { CardSkeleton, ListSkeleton } from '../../components/Skeleton'
import { usePageTitle } from '../../hooks/usePageTitle'
import { fmtDateTime } from '../../utils/time'

const EVENT_TYPE_META = {
  research: { label: '专题调研', icon: FileSearch, classes: 'bg-[#e7edf0] text-[#245f8f]' },
  tracker: { label: '监测', icon: RadioTower, classes: 'bg-[#e7edf0] text-[#245f8f]' },
  graph: { label: '关系图谱', icon: Network, classes: 'bg-[#e7edf0] text-[#245f8f]' },
} satisfies Record<IntelligenceEventType, { label: string; icon: LucideIcon; classes: string }>

const EVENT_STATUS_META = {
  queued: { label: '排队中', classes: 'bg-black/[0.045] text-slate-600', dot: 'bg-slate-400' },
  running: { label: '运行中', classes: 'bg-[#e7edf0] text-[#245f8f]', dot: 'bg-[#245f8f]' },
  completed: { label: '已完成', classes: 'bg-[#e9f3ee] text-[#28745a]', dot: 'bg-[#2f8d6a]' },
  failed: { label: '失败', classes: 'bg-[#fff0ea] text-[#a64b31]', dot: 'bg-[#c45d3e]' },
} satisfies Record<IntelligenceEventStatus, { label: string; classes: string; dot: string }>

const ASSET_TYPE_META = {
  competitor: { label: '对象', icon: Building2, classes: 'bg-[#e7edf0] text-[#245f8f]' },
  profile: { label: '画像', icon: Sparkles, classes: 'bg-[#e7edf0] text-[#245f8f]' },
  research_task: { label: '调研', icon: FileSearch, classes: 'bg-[#e7edf0] text-[#245f8f]' },
  graph_project: { label: '图谱', icon: Network, classes: 'bg-[#e7edf0] text-[#245f8f]' },
} satisfies Record<IntelligenceObjectType, { label: string; icon: LucideIcon; classes: string }>

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-red-100 bg-red-50/60 px-5 text-center">
      <AlertCircle className="h-5 w-5 text-red-500" />
      <p className="mt-2 text-sm text-red-700">{message}</p>
      <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:underline">
        <RefreshCw className="h-3.5 w-3.5" /> 重新加载
      </button>
    </div>
  )
}

function SectionHeader({ title, description, to, linkLabel }: { title: string; description: string; to?: string; linkLabel?: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-[-0.015em] text-[#111a28]">{title}</h2>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      {to && <Link to={to} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#245f8f] hover:text-[#17446a]">{linkLabel ?? '查看全部'} <ArrowRight className="h-3.5 w-3.5" /></Link>}
    </div>
  )
}

function MetricCard({ label, value, note, icon: Icon, classes, to }: {
  label: string
  value: number
  note: string
  icon: LucideIcon
  classes: string
  to: string
}) {
  return (
    <Link to={to} className="group rounded-2xl border border-black/[0.09] bg-[#fbfaf6] p-4 shadow-[0_8px_24px_rgba(17,26,40,0.035)] transition hover:-translate-y-0.5 hover:border-[#245f8f]/25 hover:shadow-[0_14px_34px_rgba(17,26,40,0.08)] motion-reduce:transform-none motion-reduce:transition-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[#111a28]">{value}</p>
        </div>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${classes}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-2 flex items-center justify-between text-xs text-slate-400"><span>{note}</span><ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:text-[#245f8f] motion-reduce:transform-none" /></p>
    </Link>
  )
}

function EventFeed({ events }: { events: IntelligenceEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center text-center">
        <Activity className="h-8 w-8 text-gray-300" />
        <p className="mt-3 text-sm font-medium text-gray-700">还没有情报事件</p>
        <p className="mt-1 max-w-xs text-xs leading-5 text-gray-400">发起调研、运行监测或构建图谱后，变化会汇聚到这里。</p>
        <Link to="/app/new" className="mt-3 text-xs font-semibold text-blue-600 hover:underline">发起首次分析</Link>
      </div>
    )
  }

  return (
    <div className="mt-4 divide-y divide-black/[0.055]">
      {events.slice(0, 6).map((event) => {
        const type = EVENT_TYPE_META[event.event_type]
        const status = EVENT_STATUS_META[event.status]
        const TypeIcon = type.icon
        return (
          <Link key={event.id} to={event.href} className="group flex gap-3 py-3.5 first:pt-0 last:pb-0">
            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${type.classes}`}><TypeIcon className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-[#111a28] group-hover:text-[#245f8f]">{event.title}</span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${status.classes}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}
                </span>
              </span>
              <span className="mt-1 block truncate text-xs text-gray-500">{event.summary || `${type.label}事件暂无摘要`}</span>
              <span className="mt-1.5 block text-[11px] text-gray-400">{type.label} · {fmtDateTime(event.occurred_at)}</span>
            </span>
            <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-slate-300 group-hover:text-[#245f8f]" />
          </Link>
        )
      })}
    </div>
  )
}

function AssetList({ assets }: { assets: IntelligenceObject[] }) {
  if (assets.length === 0) {
    return <div className="py-12 text-center text-sm text-gray-400">还没有可展示的情报资产</div>
  }
  return (
    <div className="mt-4 space-y-1">
      {assets.slice(0, 5).map((asset) => {
        const meta = ASSET_TYPE_META[asset.type]
        const Icon = meta.icon
        return (
          <Link key={asset.id} to={asset.detail_path} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-black/[0.035]">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.classes}`}><Icon className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[#26303c] group-hover:text-[#245f8f]">{asset.title}</span>
              <span className="mt-0.5 block truncate text-[11px] text-gray-400">{meta.label} · 更新于 {fmtDateTime(asset.updated_at)}</span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-[#245f8f]" />
          </Link>
        )
      })}
    </div>
  )
}

export default function DashboardPage() {
  usePageTitle('情报总览')
  const { unreadCount, unreadError, refreshUnreadCount } = useAppLayoutContext()
  const [summary, setSummary] = useState<IntelligenceEventSummary | null>(null)
  const [events, setEvents] = useState<IntelligenceEvent[]>([])
  const [assets, setAssets] = useState<IntelligenceObject[]>([])
  const [trackers, setTrackers] = useState<Tracker[]>([])
  const [summaryError, setSummaryError] = useState('')
  const [eventsError, setEventsError] = useState('')
  const [assetsError, setAssetsError] = useState('')
  const [trackersError, setTrackersError] = useState('')
  const [criticalLoading, setCriticalLoading] = useState(true)
  const [trackersLoading, setTrackersLoading] = useState(true)
  const [refreshingEvents, setRefreshingEvents] = useState(false)

  const loadSummary = useCallback(async () => {
    setSummaryError('')
    try {
      setSummary(await getIntelligenceEventSummary())
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : '事件摘要加载失败')
    }
  }, [])

  const loadEvents = useCallback(async () => {
    setEventsError('')
    try {
      const result = await listIntelligenceEvents({ page: 1, pageSize: 12 })
      setEvents(result.items)
    } catch (error) {
      setEventsError(error instanceof Error ? error.message : '最新事件加载失败')
    }
  }, [])

  const loadAssets = useCallback(async () => {
    setAssetsError('')
    try {
      const result = await listAssets({ page: 1, pageSize: 5 })
      setAssets(result.items)
    } catch (error) {
      setAssetsError(error instanceof Error ? error.message : '最近资产加载失败')
    }
  }, [])

  const loadTrackers = useCallback(async () => {
    setTrackersLoading(true)
    setTrackersError('')
    try {
      setTrackers(await listTrackers(1, 20))
    } catch (error) {
      setTrackersError(error instanceof Error ? error.message : '监测数据不可用，可能需要企业权限')
    } finally {
      setTrackersLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    setCriticalLoading(true)
    Promise.allSettled([loadSummary(), loadEvents(), loadAssets()]).finally(() => {
      if (active) setCriticalLoading(false)
    })
    loadTrackers()
    return () => { active = false }
  }, [loadAssets, loadEvents, loadSummary, loadTrackers])

  const hasRunningEvent = events.some((event) => event.status === 'running')
  useEffect(() => {
    if (!hasRunningEvent) return
    const timer = window.setInterval(async () => {
      setRefreshingEvents(true)
      await Promise.allSettled([loadEvents(), loadSummary()])
      setRefreshingEvents(false)
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [hasRunningEvent, loadEvents, loadSummary])

  const failedEvents = useMemo(() => events.filter((event) => event.status === 'failed'), [events])
  const runningEvents = useMemo(() => events.filter((event) => event.status === 'running'), [events])
  const activeTrackers = useMemo(() => trackers.filter((tracker) => tracker.enabled).slice(0, 5), [trackers])
  const needsAttention = (summary?.failed ?? failedEvents.length) + unreadCount

  const retryCritical = () => {
    setCriticalLoading(true)
    Promise.allSettled([loadSummary(), loadEvents(), loadAssets()]).finally(() => setCriticalLoading(false))
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <section className="relative isolate overflow-hidden rounded-3xl border border-white/[0.08] bg-[#111a28] px-5 py-7 text-white shadow-[0_22px_60px_rgba(17,26,40,0.16)] sm:px-8 sm:py-8">
        <img src="/rivalscope-ink-hero.png" alt="" className="pointer-events-none absolute inset-0 -z-20 h-full w-full object-cover object-[76%_48%] opacity-45 grayscale" />
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(17,26,40,0.99),rgba(17,26,40,0.9)_48%,rgba(17,26,40,0.28))]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(242,140,40,0.85),transparent)]" />
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#8ab4d2]">Intelligence overview</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">今天的情报，从事件开始</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              {criticalLoading
                ? '正在汇聚最新事件与资产…'
                : `共 ${summary?.total ?? events.length} 条事件，${summary?.active ?? runningEvents.length} 项正在运行，${needsAttention} 项需要关注。`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/app/competitors" className="inline-flex items-center gap-2 rounded-full bg-[#f8f6f0] px-4 py-2 text-sm font-semibold text-[#111a28] hover:bg-white"><Building2 className="h-4 w-4 text-[#245f8f]" />添加对象</Link>
            <Link to="/app/trackers" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.08] px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm hover:bg-white/[0.14]"><RadioTower className="h-4 w-4" />创建监测</Link>
            <Link to="/app/new" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.08] px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm hover:bg-white/[0.14]"><Sparkles className="h-4 w-4" />发起分析</Link>
          </div>
        </div>
      </section>

      {criticalLoading ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <CardSkeleton key={index} />)}</div>
      ) : summaryError ? (
        <div className="mt-5"><ErrorState message={summaryError} onRetry={loadSummary} /></div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="事件总量" value={summary?.total ?? events.length} note="查看全部事件" icon={Activity} classes="bg-[#e7edf0] text-[#245f8f]" to="/app/intelligence" />
          <MetricCard label="正在运行" value={summary?.active ?? runningEvents.length} note={refreshingEvents ? '正在刷新状态' : hasRunningEvent ? '每 15 秒自动更新' : '当前无运行事件'} icon={Clock3} classes="bg-[#e7edf0] text-[#245f8f]" to="/app/intelligence" />
          <MetricCard label="已完成" value={summary?.completed ?? 0} note="查看分析成果" icon={CheckCircle2} classes="bg-[#e7edf0] text-[#245f8f]" to="/app/intelligence" />
          <MetricCard label="需要关注" value={summary?.failed ?? failedEvents.length} note="检查失败事件" icon={AlertTriangle} classes="bg-[#fff1df] text-[#b45f06]" to="/app/intelligence" />
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
        <section className="rounded-2xl border border-black/[0.09] bg-[#fbfaf6] p-5 shadow-[0_10px_30px_rgba(17,26,40,0.04)]">
          <SectionHeader title="最新情报事件" description="调研、监测与图谱的最新变化" to="/app/intelligence" />
          {criticalLoading ? <div className="mt-4"><ListSkeleton count={5} /></div> : eventsError ? <div className="mt-4"><ErrorState message={eventsError} onRetry={loadEvents} /></div> : <EventFeed events={events} />}
        </section>

        <section className="rounded-2xl border border-black/[0.09] bg-[#fbfaf6] p-5 shadow-[0_10px_30px_rgba(17,26,40,0.04)]">
          <SectionHeader title="需要处理" description="失败、运行中事项与未读通知" />
          <div className="mt-4 space-y-2.5">
            {failedEvents.slice(0, 3).map((event) => (
              <Link key={event.id} to={event.href} className="flex items-start gap-3 rounded-xl border border-[#c45d3e]/15 bg-[#fff0ea]/65 p-3 hover:border-[#c45d3e]/30">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#a64b31]" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[#4c2a21]">{event.title}</span><span className="mt-0.5 block text-xs text-[#a64b31]">处理失败事件</span></span>
                <ArrowRight className="mt-1 h-3.5 w-3.5 text-[#c98773]" />
              </Link>
            ))}
            {runningEvents.slice(0, 3).map((event) => (
              <Link key={event.id} to={event.href} className="flex items-start gap-3 rounded-xl border border-[#245f8f]/15 bg-[#e7edf0]/70 p-3 hover:border-[#245f8f]/30">
                <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#245f8f] motion-reduce:animate-none" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[#173b58]">{event.title}</span><span className="mt-0.5 block text-xs text-[#245f8f]">查看运行进度</span></span>
                <ArrowRight className="mt-1 h-3.5 w-3.5 text-[#6e98b7]" />
              </Link>
            ))}
            {unreadCount > 0 && (
              <button type="button" onClick={() => window.dispatchEvent(new Event('open-notifications'))} className="flex w-full items-start gap-3 rounded-xl border border-[#f28c28]/20 bg-[#fff8ee] p-3 text-left hover:border-[#f28c28]/40">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-[#b45f06]" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-[#503217]">{unreadCount} 条未读通知</span><span className="mt-0.5 block text-xs text-[#b45f06]">打开通知中心查看</span></span>
                <ArrowRight className="mt-1 h-3.5 w-3.5 text-[#f28c28]" />
              </button>
            )}
            {unreadError && <ErrorState message={unreadError} onRetry={refreshUnreadCount} />}
            {!eventsError && failedEvents.length === 0 && runningEvents.length === 0 && unreadCount === 0 && !unreadError && (
              <div className="flex min-h-44 flex-col items-center justify-center text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                <p className="mt-3 text-sm font-medium text-gray-700">当前没有待处理事项</p>
                <p className="mt-1 text-xs text-gray-400">有新变化时会在这里提示你。</p>
              </div>
            )}
            {eventsError && <ErrorState message="待处理事件暂时无法加载" onRetry={loadEvents} />}
          </div>
        </section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="rounded-2xl border border-black/[0.09] bg-[#fbfaf6] p-5 shadow-[0_10px_30px_rgba(17,26,40,0.04)]">
          <SectionHeader title="最近情报资产" description="最近更新的对象、报告、画像与图谱" to="/app/assets" />
          {criticalLoading ? <div className="mt-4"><ListSkeleton count={4} /></div> : assetsError ? <div className="mt-4"><ErrorState message={assetsError} onRetry={loadAssets} /></div> : <AssetList assets={assets} />}
        </section>

        <section className="rounded-2xl border border-black/[0.09] bg-[#fbfaf6] p-5 shadow-[0_10px_30px_rgba(17,26,40,0.04)]">
          <SectionHeader title="活跃监测" description="已启用的自动监测规则" to="/app/trackers" />
          {trackersLoading ? <div className="mt-4"><ListSkeleton count={4} /></div> : trackersError ? <div className="mt-4"><ErrorState message={trackersError} onRetry={loadTrackers} /></div> : activeTrackers.length ? (
            <div className="mt-4 space-y-1">
              {activeTrackers.map((tracker) => (
                <Link key={tracker.id} to={`/app/trackers/${tracker.id}`} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-black/[0.035]">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e7edf0] text-[#245f8f]"><RadioTower className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-[#26303c] group-hover:text-[#245f8f]">{tracker.product_name}</span><span className="mt-0.5 block text-[11px] text-gray-400">{tracker.running ? '正在运行' : tracker.next_run_at ? `下次 ${fmtDateTime(tracker.next_run_at)}` : '已启用'}</span></span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-[#245f8f]" />
                </Link>
              ))}
            </div>
          ) : <div className="py-12 text-center"><RadioTower className="mx-auto h-7 w-7 text-gray-300" /><p className="mt-2 text-sm text-gray-500">暂无活跃监测</p><Link to="/app/trackers" className="mt-2 inline-block text-xs font-semibold text-blue-600 hover:underline">创建监测</Link></div>}
        </section>

        <section className="rounded-2xl border border-black/[0.09] bg-[#fbfaf6] p-5 shadow-[0_10px_30px_rgba(17,26,40,0.04)]">
          <SectionHeader title="快速分析" description="从问题出发，选择合适的分析方式" />
          <div className="mt-4 space-y-2">
            {[
              { to: '/app/new', label: '专题调研', description: '围绕产品与市场问题生成研究报告', icon: FileSearch, classes: 'bg-[#e7edf0] text-[#245f8f]' },
              { to: '/app/profiles', label: '画像与对比', description: '沉淀对象画像并进行横向比较', icon: Sparkles, classes: 'bg-[#e7edf0] text-[#245f8f]' },
              { to: '/app/graph', label: '关系图谱', description: '发现产业链实体与关系网络', icon: Network, classes: 'bg-[#e7edf0] text-[#245f8f]' },
            ].map((action) => (
              <Link key={action.label} to={action.to} className="group flex items-center gap-3 rounded-xl border border-black/[0.07] p-3 hover:border-[#245f8f]/20 hover:bg-[#e7edf0]/45">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${action.classes}`}><action.icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[#26303c] group-hover:text-[#245f8f]">{action.label}</span><span className="mt-0.5 block text-xs text-gray-400">{action.description}</span></span>
                <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-[#245f8f]" />
              </Link>
            ))}
          </div>
        </section>
      </div>

      {(summaryError || eventsError || assetsError) && !criticalLoading && (
        <button type="button" onClick={retryCritical} className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-blue-700"><RefreshCw className="h-3.5 w-3.5" />重试所有失败模块</button>
      )}
    </div>
  )
}

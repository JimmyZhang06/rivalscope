import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, CheckCircle2, FileSearch, Network, Radio, RefreshCw } from 'lucide-react'
import { getIntelligenceEventSummary, listIntelligenceEvents } from '../../api/client'
import type {
  IntelligenceEvent,
  IntelligenceEventStatus,
  IntelligenceEventSummary,
  IntelligenceEventType,
} from '../../api/types'
import { usePageTitle } from '../../hooks/usePageTitle'
import { fmtDateTime } from '../../utils/time'
import AppSelect from '../../components/AppSelect'

type TypeFilter = 'all' | IntelligenceEventType
type StatusFilter = 'all' | IntelligenceEventStatus

const TYPE_META = {
  research: { label: '调研', icon: FileSearch, color: 'bg-blue-100 text-blue-700' },
  tracker: { label: '追踪', icon: Radio, color: 'bg-violet-100 text-violet-700' },
  graph: { label: '图谱', icon: Network, color: 'bg-cyan-100 text-cyan-700' },
} satisfies Record<IntelligenceEventType, { label: string; icon: typeof Activity; color: string }>

const STATUS_META = {
  queued: { label: '排队中', color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  running: { label: '进行中', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  completed: { label: '已完成', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  failed: { label: '失败', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
} satisfies Record<IntelligenceEventStatus, { label: string; color: string; dot: string }>

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: '全部来源' },
  { value: 'research', label: '调研' },
  { value: 'tracker', label: '追踪' },
  { value: 'graph', label: '图谱' },
]

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'queued', label: '排队中' },
  { value: 'running', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
]

const PAGE_SIZE = 20

export default function IntelligenceEventsPage() {
  usePageTitle('事件与监测')
  const [events, setEvents] = useState<IntelligenceEvent[]>([])
  const [summary, setSummary] = useState<IntelligenceEventSummary | null>(null)
  const [eventType, setEventType] = useState<TypeFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const [eventResult, summaryResult] = await Promise.all([
        listIntelligenceEvents({ eventType, status, page, pageSize: PAGE_SIZE }),
        getIntelligenceEventSummary(),
      ])
      setEvents(eventResult.items)
      setTotal(eventResult.total)
      setSummary(summaryResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : '事件流加载失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [eventType, page, status])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!summary?.active) return
    const timer = window.setInterval(() => load(true), 15000)
    return () => window.clearInterval(timer)
  }, [load, summary?.active])

  const changeType = (value: TypeFilter) => {
    setEventType(value)
    setPage(1)
  }
  const changeStatus = (value: StatusFilter) => {
    setStatus(value)
    setPage(1)
  }
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="h-6 w-6 text-blue-600" />
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">事件流与监测中心</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">统一查看调研、定时追踪与关系图谱的最新动态</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 shadow-sm transition hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: '事件总量', value: summary?.total ?? 0, icon: Activity, color: 'text-slate-600 bg-slate-100' },
          { label: '正在监测', value: summary?.active ?? 0, icon: Radio, color: 'text-blue-700 bg-blue-100' },
          { label: '已完成', value: summary?.completed ?? 0, icon: CheckCircle2, color: 'text-emerald-700 bg-emerald-100' },
          { label: '需关注', value: summary?.failed ?? 0, icon: AlertTriangle, color: 'text-red-700 bg-red-100' },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">{card.label}</span>
              <span className={`rounded-md p-2 ${card.color}`}><card.icon className="h-4 w-4" /></span>
            </div>
            <p className="mt-2 text-2xl font-bold text-gray-900">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-1 rounded-md bg-gray-100 p-1">
          {TYPE_FILTERS.map((item) => (
            <button
              key={item.value}
              onClick={() => changeType(item.value)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition ${eventType === item.value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
            >
              {item.label}{item.value !== 'all' && summary ? ` ${summary.by_type[item.value]}` : ''}
            </button>
          ))}
        </div>
        <AppSelect
          value={status}
          onValueChange={(nextValue) => changeStatus(nextValue as StatusFilter)}
          ariaLabel="筛选事件状态"
          options={STATUS_FILTERS}
          size="sm"
        />
        <span className="ml-auto self-center text-xs text-gray-400">当前筛选 {total} 条</span>
      </div>

      {error && <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">正在汇聚事件…</div>
      ) : events.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-gray-300 bg-white py-16 text-center">
          <Radio className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-700">当前筛选下没有事件</p>
          <p className="mt-1 text-xs text-gray-400">新建调研、运行追踪或构建图谱后，动态会出现在这里</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {events.map((event, index) => {
            const typeMeta = TYPE_META[event.event_type]
            const statusMeta = STATUS_META[event.status]
            const TypeIcon = typeMeta.icon
            return (
              <Link
                key={event.id}
                to={event.href}
                className={`flex gap-4 p-5 transition hover:bg-gray-50 ${index ? 'border-t border-gray-100' : ''}`}
              >
                <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${typeMeta.color}`}>
                  <TypeIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-gray-900">{event.title}</h2>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusMeta.color}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot} ${event.status === 'running' ? 'animate-pulse' : ''}`} />
                      {statusMeta.label}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-500">{typeMeta.label}</span>
                  </div>
                  {event.summary && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-gray-500">{event.summary}</p>}
                  <p className="mt-2 text-xs text-gray-400">{fmtDateTime(event.occurred_at)}</p>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {pageCount > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 disabled:opacity-40">上一页</button>
          <span className="text-xs text-gray-500">{page} / {pageCount}</span>
          <button disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 disabled:opacity-40">下一页</button>
        </div>
      )}
    </div>
  )
}

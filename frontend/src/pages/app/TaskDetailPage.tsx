import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { getResearch, subscribeEvents } from '../../api/client'
import type { Source, SourceTier, Step, TaskBrief, TaskDetail, TaskStatus } from '../../api/types'
import BackToTop from '../../components/BackToTop'
import PhaseStepper from '../../components/PhaseStepper'
import ReadingProgress from '../../components/ReadingProgress'
import ReportToc from '../../components/ReportToc'
import ReportView from '../../components/ReportView'
import ScoreBars from '../../components/ScoreBars'
import ScoreRadar from '../../components/ScoreRadar'
import SourceCard from '../../components/SourceCard'
import SourceDrawer from '../../components/SourceDrawer'
import StatusBadge from '../../components/StatusBadge'
import StepTimeline from '../../components/StepTimeline'
import SwotGrid from '../../components/SwotGrid'
import { TIER_LABELS } from '../../components/TierBadge'
import { exportMarkdown, exportPdf, exportWord } from '../../utils/exportReport'

const RUNNING = new Set<TaskStatus>(['pending', 'planning', 'searching', 'analyzing', 'reporting'])
const TIER_ORDER: SourceTier[] = ['official', 'media', 'community', 'other']
const TIER_BAR_COLORS: Record<SourceTier, string> = {
  official: 'bg-blue-500',
  media: 'bg-amber-400',
  community: 'bg-green-500',
  other: 'bg-gray-300',
}

type Tab = 'report' | 'insights' | 'sources'
type SourceSort = 'score' | 'index' | 'date'

/** 后端时间为 UTC，序列化可能不带时区后缀，缺失时补 Z 再解析 */
function parseUtc(iso: string) {
  return new Date(/Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`
}

/** 新建页跳转时通过路由 state 秒传任务概要，免去"加载中"闪屏 */
function briefToDetail(brief: TaskBrief): TaskDetail {
  return { ...brief, report_markdown: '', report_data: null, steps: [], sources: [] }
}

/** 来源可信度概览统计 */
function useSourceStats(sources: Source[]) {
  return useMemo(() => {
    const tierCount = new Map<SourceTier, number>()
    const dates: string[] = []
    const dimensions = new Set<string>()
    for (const s of sources) {
      tierCount.set(s.tier, (tierCount.get(s.tier) ?? 0) + 1)
      if (s.published_at) dates.push(s.published_at.slice(0, 10))
      if (s.dimension) dimensions.add(s.dimension)
    }
    dates.sort()
    return {
      tierCount,
      dimensions: [...dimensions],
      timeSpan: dates.length >= 2 ? `${dates[0]} ~ ${dates[dates.length - 1]}` : dates[0] ?? '',
    }
  }, [sources])
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  // 从新建页跳转时直接用路由 state 初始化，页面即刻进入执行视图
  const initial = useMemo(() => {
    const brief = (location.state as { task?: TaskBrief } | null)?.task
    return brief && brief.id === id ? briefToDetail(brief) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [task, setTask] = useState<TaskDetail | null>(initial)
  const [steps, setSteps] = useState<Step[]>([])
  const [status, setStatus] = useState<TaskStatus>(initial?.status ?? 'pending')
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<Tab>('report')
  const [tierFilter, setTierFilter] = useState<SourceTier | 'all'>('all')
  const [dimFilter, setDimFilter] = useState<string>('all')
  const [sourceSort, setSourceSort] = useState<SourceSort>('score')
  const [drawer, setDrawer] = useState<{ source: Source; index: number } | null>(null)
  const [showSteps, setShowSteps] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const subscribed = useRef(false)

  const loadDetail = useCallback(async () => {
    if (!id) return
    try {
      const detail = await getResearch(id)
      setTask(detail)
      setSteps(detail.steps)
      setStatus(detail.status)
    } catch {
      setNotFound(true)
    }
  }, [id])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  // 任务运行中时订阅 SSE 实时进度
  useEffect(() => {
    if (!id || !task || subscribed.current || !RUNNING.has(task.status)) return
    subscribed.current = true
    const unsubscribe = subscribeEvents(
      id,
      (step) => {
        setSteps((prev) => (prev.some((s) => s.id === step.id) ? prev : [...prev, step]))
      },
      (s) => {
        setStatus(s)
        if (s === 'completed' || s === 'failed') loadDetail() // 结束后拉取完整报告与来源
      },
    )
    return unsubscribe
  }, [id, task, loadDetail])

  const sources = task?.sources ?? []
  const stats = useSourceStats(sources)
  const running = RUNNING.has(status)

  // 运行中的用时计时
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  // 时间线自动滚动到最新步骤
  const timelineRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = timelineRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [steps.length])

  const reportData =
    task?.report_data && task.report_data.competitors?.length > 0 && task.report_data.dimensions?.length > 0
      ? task.report_data
      : null

  // 引用编号 = 来源列表顺序（与后端材料编号一致）
  const openCite = useCallback(
    (n: number) => {
      const source = sources[n - 1]
      if (source) setDrawer({ source, index: n })
    },
    [sources],
  )

  // 筛选后仍保留原始引用编号，支持三种排序
  const filteredSources = useMemo(() => {
    const list = sources
      .map((source, i) => ({ source, index: i + 1 }))
      .filter(({ source }) => tierFilter === 'all' || source.tier === tierFilter)
      .filter(({ source }) => dimFilter === 'all' || source.dimension === dimFilter)
    switch (sourceSort) {
      case 'index':
        return list.sort((a, b) => a.index - b.index)
      case 'date':
        return list.sort((a, b) => (b.source.published_at || '').localeCompare(a.source.published_at || ''))
      default:
        return list.sort((a, b) => b.source.score - a.source.score)
    }
  }, [sources, tierFilter, dimFilter, sourceSort])

  // 导出下拉：点击外部关闭
  useEffect(() => {
    if (!exportOpen) return
    const onDown = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [exportOpen])

  const handleExport = async (kind: 'md' | 'word' | 'pdf') => {
    if (!task?.report_markdown) return
    setExportOpen(false)
    if (kind === 'md') {
      exportMarkdown(task)
    } else if (kind === 'word') {
      exportWord(task, sources)
    } else {
      setExporting(true)
      try {
        await exportPdf(task, sources)
      } finally {
        setExporting(false)
      }
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-gray-500">任务不存在或已被删除</p>
        <Link to="/app/tasks" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
          ← 返回调研记录
        </Link>
      </div>
    )
  }

  if (!task) {
    return <p className="py-16 text-center text-sm text-gray-400">加载中…</p>
  }

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'report', label: '调研报告', icon: '📄' },
    ...(reportData ? [{ key: 'insights' as Tab, label: '数据洞察', icon: '📊' }] : []),
    { key: 'sources', label: `信息来源（${sources.length}）`, icon: '🔗' },
  ]

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {tab === 'report' && !!task.report_markdown && !running && <ReadingProgress />}
      <BackToTop />
      {/* 头部 */}
      <div className="no-print mb-6">
        <Link to="/app/tasks" className="text-sm text-blue-600 hover:underline">
          ← 返回调研记录
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{task.product_name}</h1>
          <StatusBadge status={status} />
          {status === 'completed' && task.report_markdown && (
            <>
              <div ref={exportRef} className="relative">
                <button
                  onClick={() => setExportOpen((v) => !v)}
                  disabled={exporting}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-blue-300 hover:text-blue-600 disabled:opacity-60"
                >
                  {exporting ? '⏳ 正在生成 PDF…' : '⬇ 导出报告 ▾'}
                </button>
                {exportOpen && (
                  <div className="absolute left-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                    {(
                      [
                        { kind: 'pdf', icon: '📕', label: 'PDF 文档 (.pdf)' },
                        { kind: 'word', icon: '📘', label: 'Word 文档 (.doc)' },
                        { kind: 'md', icon: '📝', label: 'Markdown (.md)' },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.kind}
                        onClick={() => handleExport(item.kind)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 transition hover:bg-blue-50 hover:text-blue-700"
                      >
                        <span>{item.icon}</span>
                        {item.label}
                      </button>
                    ))}
                    <div className="my-1 border-t border-gray-100" />
                    <button
                      onClick={() => {
                        setExportOpen(false)
                        setTab('report')
                        setTimeout(() => window.print(), 100)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-500 transition hover:bg-gray-50 hover:text-gray-700"
                    >
                      <span>🖨</span>
                      浏览器打印…
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {!running && steps.length > 0 && (
            <button
              onClick={() => setShowSteps((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                showSteps
                  ? 'border-blue-300 bg-blue-50 text-blue-600'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              🕐 执行过程{showSteps ? ' ▲' : ' ▼'}
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {task.competitors && <>竞品：{task.competitors} · </>}
          {task.focus && <>调研重点：{task.focus} · </>}
          创建于 {new Date(task.created_at).toLocaleString('zh-CN')}
        </p>

        {/* 执行进度：运行中为一体化执行视图（状态头 + 阶段步骤条 + 实时时间线）；完成后由按钮折叠展开 */}
        {running && (
          <div className="mt-4 overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-500 px-5 py-4 text-white">
              <div>
                <p className="text-sm font-semibold">🤖 Agent 正在调研「{task.product_name}」</p>
                <p className="mt-0.5 text-xs text-blue-100">全流程自动执行，报告生成后将自动展示，无需刷新页面</p>
              </div>
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs tabular-nums">
                ⏱ 已用时 {formatElapsed(now - parseUtc(task.created_at).getTime())}
              </span>
            </div>
            <div className="px-5 py-5">
              <PhaseStepper status={status} />
              <div ref={timelineRef} className="mt-5 max-h-72 overflow-y-auto border-t border-gray-100 pr-1 pt-4">
                <StepTimeline steps={steps} running />
              </div>
            </div>
          </div>
        )}
        {!running && showSteps && (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">执行过程</h2>
            {steps.length === 0 ? (
              <p className="text-sm text-gray-400">暂无步骤记录</p>
            ) : (
              <div className="max-h-80 overflow-y-auto pr-1">
                <StepTimeline steps={steps} running={false} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 报告 / 洞察 / 来源：运行中不渲染（执行视图即主界面） */}
      {!running && (
        <main className="print-full min-w-0 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          {status === 'failed' ? (
            <div className="rounded-lg bg-red-50 p-4">
              <p className="text-sm font-medium text-red-700">调研失败</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-red-600">{task.error}</p>
            </div>
          ) : (
            <>
              <div className="no-print mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                      tab === t.key
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    <span className="text-xs">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab 1：调研报告（封面头 + TOC + 引用角标正文） */}
              {tab === 'report' &&
                (task.report_markdown ? (
                  <div>
                    {/* 报告封面头 */}
                    <div className="rounded-2xl bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-500 p-6 text-white print:rounded-none print:bg-none print:p-0 print:text-gray-900">
                      <p className="text-xs font-medium uppercase tracking-widest text-blue-100 print:text-gray-400">
                        Competitive Research Report
                      </p>
                      <h2 className="mt-1.5 text-xl font-bold leading-snug sm:text-2xl">
                        {task.product_name} 竞品调研报告
                      </h2>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-white/15 px-2.5 py-1 print:border print:border-gray-200 print:bg-transparent">
                          生成于 {new Date(task.created_at).toLocaleDateString('zh-CN')}
                        </span>
                        {task.competitors &&
                          task.competitors
                            .split(/[,，、]/)
                            .map((c) => c.trim())
                            .filter(Boolean)
                            .map((c) => (
                              <span
                                key={c}
                                className="rounded-full bg-white/15 px-2.5 py-1 print:border print:border-gray-200 print:bg-transparent"
                              >
                                vs {c}
                              </span>
                            ))}
                      </div>
                      {/* 元信息统计行 */}
                      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/20 pt-4 sm:grid-cols-4 print:border-gray-200">
                        <div>
                          <p className="text-lg font-bold">{sources.length}</p>
                          <p className="text-[11px] text-blue-100 print:text-gray-500">信息来源</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold">
                            {(stats.tierCount.get('official') ?? 0) + (stats.tierCount.get('media') ?? 0)}
                          </p>
                          <p className="text-[11px] text-blue-100 print:text-gray-500">官方与媒体来源</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold">{stats.dimensions.length || '—'}</p>
                          <p className="text-[11px] text-blue-100 print:text-gray-500">检索维度</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold">{reportData ? reportData.competitors.length : '—'}</p>
                          <p className="text-[11px] text-blue-100 print:text-gray-500">对比产品</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 flex gap-8">
                      <div className="min-w-0 flex-1">
                        <ReportView markdown={task.report_markdown} sources={sources} onCite={openCite} />
                      </div>
                      {/* 目录：右侧悬浮，仅屏幕阅读辅助，打印/导出完全排除（no-print 连外层占位一起隐藏） */}
                      <div className="no-print hidden w-52 shrink-0 lg:block">
                        <ReportToc markdown={task.report_markdown} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-gray-400">暂无报告</p>
                ))}

              {/* Tab 2：数据洞察 */}
              {tab === 'insights' && reportData && (
                <div className="space-y-4">
                  {reportData.verdict && (
                    <div className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 p-4 text-white shadow-sm">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-100">
                        💡 总体结论
                      </p>
                      <p className="mt-1.5 text-sm font-medium leading-relaxed">{reportData.verdict}</p>
                    </div>
                  )}
                  <ScoreRadar data={reportData} />
                  <ScoreBars data={reportData} />
                  <SwotGrid data={reportData} productName={task.product_name} />
                  <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-base">🎯</span>
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">一句话定位</h3>
                        <p className="text-xs text-gray-400">各产品的市场定位速览</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {reportData.competitors.map((c) => (
                        <div key={c.name} className="rounded-lg bg-gray-50 p-3">
                          <p className="text-xs font-semibold text-gray-900">{c.name}</p>
                          <p className="mt-1 text-xs leading-relaxed text-gray-600">{c.positioning}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3：信息来源 */}
              {tab === 'sources' && (
                <div>
                  {/* 概览统计卡 */}
                  <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                      <p className="text-xl font-bold text-gray-900">{sources.length}</p>
                      <p className="mt-0.5 text-xs text-gray-500">信息来源总数</p>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                      <p className="text-xl font-bold text-blue-600">
                        {sources.length
                          ? Math.round(
                              (((stats.tierCount.get('official') ?? 0) + (stats.tierCount.get('media') ?? 0)) /
                                sources.length) *
                                100,
                            )
                          : 0}
                        %
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">官方与媒体占比</p>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                      <p className="text-xl font-bold text-gray-900">{stats.dimensions.length || '—'}</p>
                      <p className="mt-0.5 text-xs text-gray-500">检索维度</p>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                      <p className="truncate text-sm font-bold leading-7 text-gray-900" title={stats.timeSpan}>
                        {stats.timeSpan || '—'}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">内容时间跨度</p>
                    </div>
                  </div>

                  {/* 可信度分布条 */}
                  {sources.length > 0 && (
                    <div className="mb-4 rounded-xl border border-gray-100 p-3.5">
                      <div className="flex h-2.5 w-full overflow-hidden rounded-full">
                        {TIER_ORDER.map((t) => {
                          const n = stats.tierCount.get(t) ?? 0
                          return n > 0 ? (
                            <div
                              key={t}
                              className={TIER_BAR_COLORS[t]}
                              style={{ width: `${(n / sources.length) * 100}%` }}
                              title={`${TIER_LABELS[t]} ${n} 条`}
                            />
                          ) : null
                        })}
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                        {TIER_ORDER.map((t) => {
                          const n = stats.tierCount.get(t) ?? 0
                          return n > 0 ? (
                            <span key={t} className="flex items-center gap-1.5">
                              <span className={`h-2 w-2 rounded-full ${TIER_BAR_COLORS[t]}`} />
                              {TIER_LABELS[t]} {n} 条 · {Math.round((n / sources.length) * 100)}%
                            </span>
                          ) : null
                        })}
                      </div>
                    </div>
                  )}

                  {/* 筛选与排序 */}
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    {(['all', ...TIER_ORDER] as const).map((t) => {
                      const count = t === 'all' ? sources.length : stats.tierCount.get(t) ?? 0
                      if (t !== 'all' && count === 0) return null
                      return (
                        <button
                          key={t}
                          onClick={() => setTierFilter(t)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                            tierFilter === t
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {t === 'all' ? '全部' : TIER_LABELS[t]} {count}
                        </button>
                      )
                    })}
                    <div className="ml-auto flex items-center gap-2">
                      {stats.dimensions.length > 1 && (
                        <select
                          value={dimFilter}
                          onChange={(e) => setDimFilter(e.target.value)}
                          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600"
                        >
                          <option value="all">全部维度</option>
                          {stats.dimensions.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      )}
                      <select
                        value={sourceSort}
                        onChange={(e) => setSourceSort(e.target.value as SourceSort)}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600"
                      >
                        <option value="score">按相关度</option>
                        <option value="index">按引用编号</option>
                        <option value="date">按发布时间</option>
                      </select>
                    </div>
                  </div>

                  {filteredSources.length === 0 ? (
                    <p className="py-8 text-center text-sm text-gray-400">没有符合条件的来源</p>
                  ) : (
                    <div className="grid gap-3 xl:grid-cols-2">
                      {filteredSources.map(({ source, index }) => (
                        <SourceCard
                          key={source.id}
                          source={source}
                          index={index}
                          onOpenDetail={(s) => setDrawer({ source: s, index })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      )}

      {/* 页面级来源抽屉：报告引用角标与来源卡片共用 */}
      {id && (
        <SourceDrawer
          taskId={id}
          source={drawer?.source ?? null}
          index={drawer?.index ?? 0}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  )
}

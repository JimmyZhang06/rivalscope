import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link, useLocation, useParams } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import {
  BarChart3,
  Bot,
  CalendarDays,
  Clock,
  FileDown,
  Timer,
  FileText,
  Lightbulb,
  Link2,
  Mail,
  MessageSquareText,
  Printer,
  RefreshCw,
  Target,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ApiError, askResearch, emailReport, getResearch, subscribeEvents } from '../../api/client'
import type { Source, SourceTier, Step, TaskBrief, TaskDetail, TaskStatus } from '../../api/types'
import BackToTop from '../../components/BackToTop'
import AppSelect from '../../components/AppSelect'
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
import { buildReportPdfBlob as buildReportPdfBlobTask, exportMarkdown as exportMarkdownTask, exportPdf as exportPdfTask, exportWord as exportWordTask } from '../../utils/exportReport'
import { parseUtc, fmtDateTime } from '../../utils/time'

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

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`
}

/** 新建页跳转时通过路由 state 秒传任务概要，免去"加载中"闪屏 */
function briefToDetail(brief: TaskBrief): TaskDetail {
  return { ...brief, report_markdown: '', report_data: null, change_summary: '', steps: [], sources: [] }
}

/** 来源可信度概览统计 */
function useSourceStats(sources: Source[]) {
  return useMemo(() => {
    const tierCount = new Map<SourceTier, number>()
    const dates: string[] = []
    const dimensions = new Set<string>()
    const freshness = { recent: 0, fresh: 0, normal: 0, old: 0, undated: 0 }
    for (const s of sources) {
      tierCount.set(s.tier, (tierCount.get(s.tier) ?? 0) + 1)
      if (s.published_at) dates.push(s.published_at.slice(0, 10))
      if (s.dimension) dimensions.add(s.dimension)
      const age = s.age_days
      if (age < 0) freshness.undated += 1
      else if (age <= 30) freshness.recent += 1
      else if (age <= 180) freshness.fresh += 1
      else if (age <= 365) freshness.normal += 1
      else freshness.old += 1
    }
    dates.sort()
    return {
      tierCount,
      dimensions: [...dimensions],
      freshness,
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
  const [loadError, setLoadError] = useState('')
  const [liveError, setLiveError] = useState('')
  const [tab, setTab] = useState<Tab>('report')
  const [tierFilter, setTierFilter] = useState<SourceTier | 'all'>('all')
  const [dimFilter, setDimFilter] = useState<string>('all')
  const [sourceSort, setSourceSort] = useState<SourceSort>('score')
  const [drawer, setDrawer] = useState<{ source: Source; index: number } | null>(null)
  const [showSteps, setShowSteps] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  // 发送到邮箱（附件走前端导出 PDF 上传后端转发）
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailMsg, setEmailMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null)
  const subscribed = useRef(false)
  // 报告追问（无状态问答线程，不持久化）
  const [qaThread, setQaThread] = useState<{ q: string; a: string }[]>([])
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState('')

  const loadDetail = useCallback(async () => {
    if (!id) return
    setLoadError('')
    try {
      const detail = await getResearch(id)
      setTask(detail)
      setSteps(detail.steps)
      setStatus(detail.status)
      setNotFound(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true)
        return
      }
      setLoadError(err instanceof Error ? err.message : '任务加载失败')
    }
  }, [id])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  // 任务运行中时订阅 SSE 实时进度
  useEffect(() => {
    if (!id || !task || subscribed.current || !RUNNING.has(status)) return
    subscribed.current = true
    const unsubscribe = subscribeEvents(
      id,
      (step) => {
        setSteps((prev) => (prev.some((s) => s.id === step.id) ? prev : [...prev, step]))
      },
      (s) => {
        setLiveError('')
        setStatus(s)
        if (s === 'completed' || s === 'failed') loadDetail() // 结束后拉取完整报告与来源
      },
      setLiveError,
    )
    return () => {
      unsubscribe()
      subscribed.current = false // SSE 断开后重置，允许重连
    }
  }, [id, status, loadDetail]) // 依赖 status 而非整个 task，断连后 status 变化可触发重连

  useEffect(() => {
    if (!liveError || !RUNNING.has(status)) return
    const timer = window.setInterval(loadDetail, 5000)
    return () => clearInterval(timer)
  }, [liveError, status, loadDetail])

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
  // 事件时间线独立于洞察评分数据（洞察失败时时间线仍可展示）
  const timeline = task?.report_data?.timeline ?? []

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

  // 引用编号 = 来源列表原始顺序（与后端材料编号一致），不受来源 Tab 的筛选影响
  const openCite = useCallback(
    (n: number) => {
      const source = sources[n - 1]
      if (source) setDrawer({ source, index: n })
    },
    [sources],
  )

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
      exportMarkdownTask(task)
    } else if (kind === 'word') {
      exportWordTask(task, sources)
    } else {
      setExporting(true)
      try {
        await exportPdfTask(task, sources)
      } finally {
        setExporting(false)
      }
    }
  }

  const handleSendEmail = async () => {
    const to = emailTo.trim()
    if (!task || !to || emailSending) return
    setEmailSending(true)
    setEmailMsg(null)
    try {
      // 前端导出 PDF → 作为附件上传后端转发（方案 C）
      const blob = await buildReportPdfBlobTask(task, sources)
      const res = await emailReport(task.id, to, blob, `竞品调研报告-${task.product_name}.pdf`)
      if (res.status === 'sent') {
        setEmailMsg({ kind: 'ok', text: `已发送给 ${res.recipients} 位收件人` })
      } else if (res.status === 'demo') {
        setEmailMsg({ kind: 'warn', text: '已提交（演示模式：后端未配置 SMTP，邮件未真实发出，已记录日志）' })
      } else {
        setEmailMsg({ kind: 'err', text: '发送失败，请检查 SMTP 配置后重试' })
      }
    } catch (err) {
      setEmailMsg({ kind: 'err', text: err instanceof Error ? err.message : '发送失败' })
    } finally {
      setEmailSending(false)
    }
  }

  const handleAsk = async () => {
    const q = question.trim()
    if (!q || !id || asking) return
    setAsking(true)
    setAskError('')
    try {
      const { answer } = await askResearch(id, q)
      setQaThread((prev) => [...prev, { q, a: answer }])
      setQuestion('')
    } catch (err) {
      setAskError(err instanceof Error ? err.message : '回答生成失败')
    } finally {
      setAsking(false)
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <p className="text-gray-500">任务不存在或已被删除</p>
        <Link to="/app/tasks" className="mt-4 inline-block text-sm text-blue-700 hover:underline">
          ← 返回调研记录
        </Link>
      </div>
    )
  }

  if (!task) {
    if (loadError) {
      return (
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-sm text-red-600">{loadError}</p>
          <button
            type="button"
            onClick={loadDetail}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            重新加载
          </button>
        </div>
      )
    }
    return <p className="py-16 text-center text-sm text-gray-400">加载中…</p>
  }

  const tabs: { key: Tab; label: string; icon: LucideIcon }[] = [
    { key: 'report', label: '调研报告', icon: FileText },
    ...(reportData || timeline.length > 0 ? [{ key: 'insights' as Tab, label: '数据洞察', icon: BarChart3 }] : []),
    { key: 'sources', label: `信息来源（${sources.length}）`, icon: Link2 },
  ]

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {tab === 'report' && !!task.report_markdown && !running && <ReadingProgress />}
      <BackToTop />
      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{loadError}</span>
          <button type="button" onClick={loadDetail} className="shrink-0 font-medium underline underline-offset-2">
            重试
          </button>
        </div>
      )}
      {liveError && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{liveError}</p>
      )}
      {/* 头部 */}
      <div className="no-print mb-6">
        <Link to="/app/tasks" className="text-sm text-blue-700 hover:underline">
          ← 返回调研记录
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{task.product_name}</h1>
          <StatusBadge status={status} />
          {status === 'completed' && task.report_markdown && (
            <>
              <div ref={exportRef} className="relative">
                <button
                  onClick={() => setExportOpen((v) => !v)}
                  disabled={exporting}
                  className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-blue-300 hover:text-blue-700 disabled:opacity-60"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  {exporting ? '正在生成 PDF…' : '导出报告 ▾'}
                </button>
                {exportOpen && (
                  <div className="absolute left-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                    {(
                      [
                        { kind: 'pdf', label: 'PDF 文档 (.pdf)' },
                        { kind: 'word', label: 'Word 文档 (.doc)' },
                        { kind: 'md', label: 'Markdown (.md)' },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.kind}
                        onClick={() => handleExport(item.kind)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 transition hover:bg-blue-50 hover:text-blue-700"
                      >
                        <FileDown className="h-3.5 w-3.5 text-gray-400" />
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
                      <Printer className="h-3.5 w-3.5 text-gray-400" />
                      浏览器打印…
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  setEmailMsg(null)
                  setEmailOpen(true)
                }}
                className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-blue-300 hover:text-blue-700"
              >
                <Mail className="h-3.5 w-3.5" />
                发送到邮箱
              </button>
            </>
          )}
          {!running && steps.length > 0 && (
            <button
              onClick={() => setShowSteps((v) => !v)}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                showSteps
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:text-blue-700'
              }`}
            >
              <Clock className="h-3.5 w-3.5" /> 执行过程{showSteps ? ' ▲' : ' ▼'}
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {task.competitors && <>竞品：{task.competitors} · </>}
          {task.focus && <>调研重点：{task.focus} · </>}
          创建于 {fmtDateTime(task.created_at)}
        </p>

        {/* 执行进度：运行中为一体化执行视图（状态头 + 阶段步骤条 + 实时时间线）；完成后由按钮折叠展开 */}
        {running && (
          <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900 px-5 py-4 text-white">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Bot className="h-4 w-4" /> Agent 正在调研「{task.product_name}」
                </p>
                <p className="mt-0.5 text-xs text-slate-400">全流程自动执行，报告生成后将自动展示，无需刷新页面</p>
              </div>
              <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs tabular-nums">
                <Timer className="h-3.5 w-3.5" /> 已用时 {formatElapsed(now - parseUtc(task.created_at).getTime())}
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
          <div className="mt-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
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
        <main className="print-full min-w-0 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          {status === 'failed' ? (
            <div className="rounded-lg bg-red-50 p-4">
              <p className="text-sm font-medium text-red-700">调研失败</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-red-600">{task.error}</p>
            </div>
          ) : (
            <>
              <div className="no-print mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
                      tab === t.key
                        ? 'bg-white text-blue-700 shadow-sm'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    <t.icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab 1：调研报告（封面头 + TOC + 引用角标正文） */}
              {tab === 'report' &&
                (task.report_markdown ? (
                  <div>
                    {/* 本期变更：定时追踪任务的与上一期对比摘要 */}
                    {task.change_summary && (
                      <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50/70 p-5">
                        <p className="flex items-center gap-1.5 text-sm font-semibold text-blue-700">
                          <RefreshCw className="h-4 w-4" /> 本期变更
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                            与上一期对比
                          </span>
                        </p>
                        <div className="prose prose-sm mt-2 max-w-none text-sm leading-relaxed text-gray-700 prose-headings:my-2 prose-headings:text-sm prose-headings:text-blue-800 prose-p:my-1 prose-ul:my-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.change_summary}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                    {/* 报告封面头 */}
                    <div className="relative overflow-hidden rounded-lg bg-slate-900 p-6 text-white print:rounded-none print:bg-transparent print:p-0 print:text-gray-900">
                      <p className="text-xs font-medium uppercase tracking-widest text-slate-400 print:text-gray-400">
                        Competitive Research Report
                      </p>
                      <h2 className="mt-1.5 text-xl font-bold leading-snug sm:text-2xl">
                        {task.product_name} 竞品调研报告
                      </h2>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-white/10 px-2.5 py-1 print:border print:border-gray-200 print:bg-transparent">
                          生成于 {fmtDateTime(task.created_at)}
                        </span>
                        {task.competitors &&
                          task.competitors
                            .split(/[,，、]/)
                            .map((c) => c.trim())
                            .filter(Boolean)
                            .map((c) => (
                              <span
                                key={c}
                                className="rounded-full bg-white/10 px-2.5 py-1 print:border print:border-gray-200 print:bg-transparent"
                              >
                                vs {c}
                              </span>
                            ))}
                      </div>
                      {/* 元信息统计行 */}
                      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/20 pt-4 sm:grid-cols-4 print:border-gray-200">
                        <div>
                          <p className="text-lg font-bold">{sources.length}</p>
                          <p className="text-[11px] text-slate-400 print:text-gray-500">信息来源</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold tabular-nums">
                            {(stats.tierCount.get('official') ?? 0) + (stats.tierCount.get('media') ?? 0)}
                          </p>
                          <p className="text-[11px] text-slate-400 print:text-gray-500">官方与媒体来源</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold">{stats.dimensions.length || '—'}</p>
                          <p className="text-[11px] text-slate-400 print:text-gray-500">检索维度</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold">{reportData ? reportData.competitors.length : '—'}</p>
                          <p className="text-[11px] text-slate-400 print:text-gray-500">对比产品</p>
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

                    {/* 报告追问：基于报告与来源的 AI 问答（会话内不持久化） */}
                    {status === 'completed' && (
                      <div className="no-print mt-8 rounded-lg border border-blue-100 bg-blue-50/40 p-5">
                        <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                          <MessageSquareText className="h-4 w-4 text-blue-700" /> 针对报告追问
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                            AI 基于报告与来源回答，不占调研额度
                          </span>
                        </p>
                        {qaThread.length > 0 && (
                          <div className="mt-4 space-y-4">
                            {qaThread.map((qa, i) => (
                              <div key={i}>
                                <p className="flex items-start gap-2 text-sm font-medium text-gray-900">
                                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                                    问
                                  </span>
                                  {qa.q}
                                </p>
                                <div className="mt-2 rounded-md border border-gray-100 bg-white p-4">
                                  <ReportView markdown={qa.a} sources={sources} onCite={openCite} showSources={false} />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {askError && (
                          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{askError}</p>
                        )}
                        <div className="mt-4 flex gap-2">
                          <input
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAsk()
                            }}
                            placeholder="如：这两个产品的定价差异主要在哪？"
                            maxLength={2000}
                            className="flex-1 rounded-md border border-gray-200 bg-white px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
                          />
                          <button
                            onClick={handleAsk}
                            disabled={asking || !question.trim()}
                            className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                          >
                            {asking ? '思考中…' : '追问'}
                          </button>
                        </div>
                        {asking && <p className="mt-2 text-xs text-gray-400">正在检索报告与来源材料生成回答…</p>}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-gray-400">暂无报告</p>
                ))}

              {/* Tab 2：数据洞察 */}
              {tab === 'insights' && reportData && (
                <div className="space-y-4">
                  {reportData.verdict && (
                    <div className="relative overflow-hidden rounded-lg bg-slate-900 p-4 text-white shadow-sm">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        <Lightbulb className="h-3.5 w-3.5" /> 总体结论
                      </p>
                      <p className="mt-1.5 text-sm font-medium leading-relaxed">{reportData.verdict}</p>
                    </div>
                  )}
                  <ScoreRadar data={reportData} />
                  <ScoreBars data={reportData} />
                  <SwotGrid data={reportData} productName={task.product_name} />
                  <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-700"><Target className="h-4 w-4" /></span>
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

              {/* 动态时间线（独立于评分洞察，抽取失败时不展示） */}
              {tab === 'insights' && timeline.length > 0 && (
                <div className={`rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${reportData ? 'mt-4' : ''}`}>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-cyan-50 text-cyan-700"><CalendarDays className="h-4 w-4" /></span>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">动态时间线</h3>
                      <p className="text-xs text-gray-400">从检索材料中抽取的关键事件，按时间降序</p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-0 border-l-2 border-blue-100 pl-5">
                    {timeline.map((ev, i) => (
                      <div key={i} className="relative pb-5 last:pb-0">
                        <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-blue-500 ring-1 ring-blue-200" />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-blue-700">
                            {ev.date}
                          </span>
                          <span className="text-sm font-medium text-gray-900">{ev.title}</span>
                          {ev.ref != null && sources[ev.ref - 1] && (
                            <button
                              onClick={() => openCite(ev.ref as number)}
                              className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 transition hover:bg-blue-600 hover:text-white"
                              title="查看来源"
                            >
                              [{ev.ref}]
                            </button>
                          )}
                        </div>
                        {ev.summary && <p className="mt-1 text-xs leading-relaxed text-gray-600">{ev.summary}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tab 3：信息来源 */}
              {tab === 'sources' && (
                <div>
                  {/* 概览统计卡 */}
                  <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-md border border-gray-100 bg-gray-50/70 p-3.5">
                      <p className="text-xl font-bold text-gray-900">{sources.length}</p>
                      <p className="mt-0.5 text-xs text-gray-500">信息来源总数</p>
                    </div>
                    <div className="rounded-md border border-gray-100 bg-gray-50/70 p-3.5">
                      <p className="text-xl font-bold text-blue-700">
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
                    <div className="rounded-md border border-gray-100 bg-gray-50/70 p-3.5">
                      <p className="text-xl font-bold text-gray-900">{stats.dimensions.length || '—'}</p>
                      <p className="mt-0.5 text-xs text-gray-500">检索维度</p>
                    </div>
                    <div className="rounded-md border border-gray-100 bg-gray-50/70 p-3.5">
                      <p className="truncate text-sm font-bold leading-7 text-gray-900" title={stats.timeSpan}>
                        {stats.timeSpan || '—'}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">内容时间跨度</p>
                    </div>
                  </div>

                  {/* 可信度分布条 */}
                  {sources.length > 0 && (
                    <div className="mb-4 rounded-md border border-gray-100 p-3.5">
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

                  {/* 信息新鲜度分布 */}
                  {sources.length > 0 && (
                    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-gray-100 bg-gray-50/70 px-3.5 py-2.5 text-xs text-gray-600">
                      <span className="font-medium text-gray-700">信息新鲜度</span>
                      {stats.freshness.recent > 0 && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />最新（≤30天）{stats.freshness.recent} 条</span>}
                      {stats.freshness.fresh > 0 && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" />较新（≤180天）{stats.freshness.fresh} 条</span>}
                      {stats.freshness.normal > 0 && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-gray-300" />一般（≤365天）{stats.freshness.normal} 条</span>}
                      {stats.freshness.old > 0 && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-orange-400" />较旧（&gt;365天）{stats.freshness.old} 条</span>}
                      {stats.freshness.undated > 0 && <span className="text-gray-400">无日期 {stats.freshness.undated} 条</span>}
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
                        <AppSelect
                          value={dimFilter}
                          onValueChange={setDimFilter}
                          ariaLabel="筛选来源维度"
                          options={[
                            { value: 'all', label: '全部维度' },
                            ...stats.dimensions.map((dimension) => ({ value: dimension, label: dimension })),
                          ]}
                          size="sm"
                        />
                      )}
                      <AppSelect
                        value={sourceSort}
                        onValueChange={(nextValue) => setSourceSort(nextValue as SourceSort)}
                        ariaLabel="来源排序方式"
                        options={[
                          { value: 'score', label: '按相关度' },
                          { value: 'index', label: '按引用编号' },
                          { value: 'date', label: '按发布时间' },
                        ]}
                        size="sm"
                      />
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

      {/* 发送到邮箱弹窗 */}
      {emailOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !emailSending && setEmailOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="email-report-title"
          >
            <div className="flex items-center justify-between">
              <h3 id="email-report-title" className="flex items-center gap-2 text-base font-semibold text-gray-900">
                <Mail className="h-4 w-4 text-blue-700" /> 发送报告到邮箱
              </h3>
              <button
                onClick={() => !emailSending && setEmailOpen(false)}
                className="text-gray-400 transition hover:text-gray-600"
                aria-label="关闭发送报告弹窗"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              将当前报告导出为 PDF 并作为附件发送。多个收件人用逗号分隔（最多 10 个）。
            </p>
            <input
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSendEmail()
              }}
              placeholder="recipient@example.com"
              disabled={emailSending}
              className="mt-4 w-full rounded-md border border-gray-200 px-3.5 py-2.5 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
            />
            {emailMsg && (
              <p
                className={`mt-3 rounded-md px-3 py-2 text-xs ${
                  emailMsg.kind === 'ok'
                    ? 'bg-green-50 text-green-700'
                    : emailMsg.kind === 'warn'
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-red-50 text-red-600'
                }`}
              >
                {emailMsg.text}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setEmailOpen(false)}
                disabled={emailSending}
                className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
              >
                关闭
              </button>
              <button
                onClick={handleSendEmail}
                disabled={emailSending || !emailTo.trim()}
                className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {emailSending ? '正在生成并发送…' : '发送'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Inbox } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { getTracker, listTrackerRuns, runTrackerNow } from '../../api/client'
import type { Tracker, TrackerRun } from '../../api/types'
import RunHistoryItem from '../../components/RunHistoryItem'
import QuotaErrorBanner from '../../components/QuotaErrorBanner'
import ScoreTrend from '../../components/ScoreTrend'
import { parseUtc } from '../../utils/time'

const FREQ_LABELS: Record<string, string> = { daily: '每日', weekly: '每周', monthly: '每月' }

/** 追踪详情：运行历史时间线 + 评分趋势 */
export default function TrackerDetailPage() {
  const { id = '' } = useParams()
  const [tracker, setTracker] = useState<Tracker | null>(null)
  const [runs, setRuns] = useState<TrackerRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  const reload = useCallback(async (showError = true) => {
    try {
      const [t, r] = await Promise.all([getTracker(id), listTrackerRuns(id)])
      setTracker(t)
      setRuns(r)
      setError('')
    } catch (err) {
      if (showError) setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    reload()
  }, [reload])

  // 有运行中的期次时轮询刷新
  useEffect(() => {
    const active = runs.some((r) => !['completed', 'failed'].includes(r.status))
    if (!active) return
    const timer = setInterval(() => reload(false), 5000)
    return () => clearInterval(timer)
  }, [runs, reload])

  const handleRunNow = async () => {
    setRunning(true)
    setError('')
    try {
      await runTrackerNow(id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '触发失败')
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-4xl px-6 py-8 text-sm text-gray-400">加载中…</div>
  }

  if (!tracker) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <p className="text-sm text-red-600">{error || '追踪项不存在'}</p>
        <Link to="/app/trackers" className="mt-3 inline-block text-sm text-blue-600 hover:underline">
          ← 返回定时追踪
        </Link>
      </div>
    )
  }

  // runs 为倒序（最新在前），时间线按最新在上展示，期数 = 总数递减
  const total = runs.length

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <nav className="flex items-center gap-1.5 text-sm text-gray-500">
        <Link to="/app/trackers" className="hover:text-blue-600">定时追踪</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-gray-900 font-medium">{tracker?.product_name ?? '加载中'}</span>
      </nav>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{tracker.product_name}</h1>
        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
          {FREQ_LABELS[tracker.frequency] ?? tracker.frequency} {String(tracker.run_hour).padStart(2, '0')}:00
        </span>
        {!tracker.enabled && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">已暂停</span>
        )}
        <span className="flex-1" />
        {tracker.running ? (
          <Link
            to={`/app/tasks/${tracker.running_task_id}`}
            className="flex items-center gap-1.5 rounded-md bg-blue-50 px-5 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            本期运行中，查看进度
          </Link>
        ) : (
          tracker.can_manage && (
            <button
              onClick={handleRunNow}
              disabled={running}
              className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {running ? '启动中…' : '立即运行'}
            </button>
          )
        )}
      </div>
      <p className="mt-1 text-sm text-gray-500">
        {tracker.competitors ? `竞品：${tracker.competitors}` : '竞品由 Agent 自动发现'}
        {tracker.focus && ` · 重点：${tracker.focus}`}
        {tracker.next_run_at &&
          tracker.enabled &&
          ` · 下次运行：${parseUtc(tracker.next_run_at).toLocaleString('zh-CN')}`}
      </p>

      {error && <QuotaErrorBanner message={error} />}

      {/* 评分趋势（≥2 期有报告时展示） */}
      <div className="mt-6">
        <ScoreTrend runs={runs} />
      </div>

      {/* 运行历史时间线 */}
      <h2 className="mt-8 text-lg font-semibold text-gray-900">运行历史（{total} 期）</h2>
      {total === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-lg border border-dashed border-gray-200 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400">
            <Inbox className="h-7 w-7" />
          </span>
          <p className="mt-3 text-sm text-gray-500">还没有运行记录，点击「立即运行」建立首期基线报告</p>
        </div>
      ) : (
        <ul className="mt-6">
          {runs.map((run, i) => (
            <RunHistoryItem key={run.id} run={run} period={total - i} isLast={i === runs.length - 1} />
          ))}
        </ul>
      )}
    </div>
  )
}

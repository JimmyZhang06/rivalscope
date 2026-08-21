import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Bot, Building2, CheckCircle2, Clock, Mail, User } from 'lucide-react'
import { createTracker, deleteTracker, runTrackerNow, updateTracker } from '../../api/client'
import type { Tracker, TrackerCreate } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import ConfirmDialog from '../../components/ConfirmDialog'
import QuotaErrorBanner from '../../components/QuotaErrorBanner'
import TrackerForm from '../../components/TrackerForm'
import { parseUtc } from '../../utils/time'
import { useTrackerStore } from '../../stores/trackerStore'

const FREQ_LABELS: Record<string, string> = { daily: '每日', weekly: '每周', monthly: '每月' }
const WEBHOOK_LABELS: Record<string, string> = {
  wecom: '企业微信',
  dingtalk: '钉钉',
  feishu: '飞书',
  generic: '通用 JSON',
}

/** 距下次运行的人性化倒计时 */
function nextRunText(tracker: Tracker): string {
  if (!tracker.enabled) return '已暂停'
  if (!tracker.next_run_at) return '—'
  const diff = parseUtc(tracker.next_run_at).getTime() - Date.now()
  if (diff <= 0) return '即将运行'
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 1) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟后`
  if (hours < 24) return `${hours} 小时后`
  return `${Math.floor(hours / 24)} 天后`
}

export default function TrackersPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Tracker | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [runningId, setRunningId] = useState('')
  const [filter, setFilter] = useState<'all' | 'mine'>('all')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteId, setDeleteId] = useState('')

  // 从 store 读取
  const trackers = useTrackerStore((s) => s.trackers)
  const hasOrg = useTrackerStore((s) => s.hasOrg)
  const storeLoading = useTrackerStore((s) => s.loading)
  const storeReload = useTrackerStore((s) => s.reload)

  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 「我创建的」= creator_id 为当前用户
  const visible = useMemo(
    () => (filter === 'mine' ? trackers.filter((t) => t.creator_id === user?.id) : trackers),
    [trackers, filter, user],
  )

  // 首次挂载加载数据
  useEffect(() => {
    storeReload()
  }, [storeReload])

  // 有运行中的追踪项时轮询刷新
  const hasRunning = trackers.some((t) => t.running)

  useEffect(() => {
    if (!hasRunning) return
    const timer = setInterval(storeReload, 5000)
    return () => clearInterval(timer)
  }, [hasRunning, storeReload])

  const handleSubmit = async (payload: TrackerCreate) => {
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      if (editing) {
        await updateTracker(editing.id, payload)
        setNotice('追踪项已更新')
      } else {
        await createTracker(payload)
        setNotice('追踪项创建成功，将按计划自动运行')
      }
      setShowForm(false)
      setEditing(null)
      await storeReload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggle = async (t: Tracker) => {
    try {
      await updateTracker(t.id, { enabled: !t.enabled })
      await storeReload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    }
  }

  const handleRunNow = async (t: Tracker) => {
    setRunningId(t.id)
    setError('')
    try {
      const run = await runTrackerNow(t.id)
      navigate(`/app/tasks/${run.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '触发失败')
    } finally {
      setRunningId('')
    }
  }

  const handleDelete = async (t: Tracker) => {
    setDeleteId(t.id)
    setConfirmOpen(true)
  }

  const doDelete = async () => {
    if (!deleteId) return
    setError('')
    try {
      await deleteTracker(deleteId)
      await storeReload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setConfirmOpen(false)
      setDeleteId('')
    }
  }

  if (storeLoading) {
    return <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-gray-400">加载中…</div>
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">定时追踪</h1>
            {hasRunning && (
              <span className="flex items-center gap-1.5 text-xs text-blue-600">
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                轮询中
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">按日/周/月自动调研目标产品，每期产出变更摘要并推送企业成员</p>
        </div>
        {hasOrg && (
          <button
            onClick={() => {
              setEditing(null)
              setShowForm(true)
            }}
            className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            ＋ 新建追踪
          </button>
        )}
      </div>

      {notice && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}
        </div>
      )}
      {error && <QuotaErrorBanner message={error} />}

      {!hasOrg ? (
        <div className="mt-16 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400">
            <Building2 className="h-7 w-7" />
          </span>
          <p className="mt-4 font-medium text-gray-900">定时追踪是企业功能</p>
          <p className="mt-1 text-sm text-gray-500">创建或加入企业后即可为团队建立自动化竞品追踪</p>
          <Link
            to="/app/account?tab=org"
            className="mt-5 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            前往企业管理
          </Link>
        </div>
      ) : trackers.length === 0 ? (
        <div className="mt-16 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400">
            <Clock className="h-7 w-7" />
          </span>
          <p className="mt-4 font-medium text-gray-900">还没有追踪项</p>
          <p className="mt-1 text-sm text-gray-500">建立第一个追踪项，让 Agent 定期帮你盯竞品</p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex w-fit gap-1 rounded-lg bg-gray-100 p-1">
            {(['all', 'mine'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                  filter === f ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {f === 'all' ? '全部' : '我创建的'}
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-4">
          {visible.map((t) => (
            <div key={t.id} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center gap-3">
                <Link to={`/app/trackers/${t.id}`} className="text-lg font-semibold text-gray-900 hover:text-blue-600">
                  {t.product_name}
                </Link>
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  {FREQ_LABELS[t.frequency] ?? t.frequency} {String(t.run_hour).padStart(2, '0')}:00
                </span>
                {t.push_email && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
                    <Mail className="h-3 w-3" /> 邮件
                  </span>
                )}
                {t.push_webhook && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">
                    <Bot className="h-3 w-3" /> {WEBHOOK_LABELS[t.webhook_type] ?? t.webhook_type}
                  </span>
                )}
                {t.creator_id === user?.id ? (
                  <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700">我创建</span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2.5 py-0.5 text-xs text-cyan-800">
                    <User className="h-3 w-3" /> {t.creator_nickname}
                  </span>
                )}
                <span className="flex-1" />
                <span className={`text-sm ${t.enabled ? 'text-gray-500' : 'text-amber-600'}`}>
                  {t.enabled ? `下次运行：${nextRunText(t)}` : '已暂停'}
                </span>
                {/* 启用开关：仅创建人或管理员可操作，否则只读 */}
                {t.can_manage ? (
                  <button
                    onClick={() => handleToggle(t)}
                    role="switch"
                    aria-checked={t.enabled}
                    className={`relative h-6 w-11 rounded-full transition ${t.enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                        t.enabled ? 'left-[22px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                ) : (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      t.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
                    }`}
                    title="仅创建人或企业管理员可修改运行状态"
                  >
                    {t.enabled ? '运行中' : '已暂停'}
                  </span>
                )}
              </div>

              {t.competitors && <p className="mt-2 text-sm text-gray-500">竞品：{t.competitors}</p>}

              {t.last_change_summary && (
                <Link
                  to={`/app/trackers/${t.id}`}
                  className="mt-3 block rounded-md bg-blue-50/60 px-4 py-3 text-sm leading-relaxed text-gray-600 transition hover:bg-blue-50"
                >
                  <span className="font-medium text-blue-700">最近变更：</span>
                  <span className="prose prose-sm prose-p:my-0 prose-ul:my-0 prose-headings:my-1">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {t.last_change_summary.slice(0, 200)}
                    </ReactMarkdown>
                  </span>
                </Link>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 text-sm">
                <span className="text-xs text-gray-400">已运行 {t.run_count} 期</span>
                <span className="flex-1" />
                {t.running ? (
                  <Link
                    to={`/app/tasks/${t.running_task_id}`}
                    className="flex items-center gap-1.5 rounded-md bg-blue-50 px-4 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                  >
                    <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                    本期运行中，查看进度
                  </Link>
                ) : (
                  t.can_manage && (
                    <button
                      onClick={() => handleRunNow(t)}
                      disabled={runningId === t.id}
                      className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                    >
                      {runningId === t.id ? '启动中…' : '立即运行'}
                    </button>
                  )
                )}
                <Link
                  to={`/app/trackers/${t.id}`}
                  className="rounded-md border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                >
                  历史与趋势
                </Link>
                {t.can_manage && (
                  <>
                    <button
                      onClick={() => {
                        setEditing(t)
                        setShowForm(true)
                      }}
                      className="rounded-md border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDelete(t)}
                      className="rounded-md border border-red-200 px-4 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="确认删除"
        message={`删除追踪项后历史报告仍将保留，确定继续？`}
        danger
        onConfirm={doDelete}
        onCancel={() => { setConfirmOpen(false); setDeleteId('') }}
      />
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
          <div role="dialog" aria-modal="true" aria-labelledby="tracker-dialog-title" className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <h3 id="tracker-dialog-title" className="text-lg font-bold text-gray-900">{editing ? '编辑追踪项' : '新建追踪项'}</h3>
            <div className="mt-5">
              <TrackerForm
                initial={editing ?? undefined}
                submitting={submitting}
                onSubmit={handleSubmit}
                onCancel={() => {
                  setShowForm(false)
                  setEditing(null)
                }}
                hasOrg={!!hasOrg}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

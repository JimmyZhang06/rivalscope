import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Globe, AlertCircle, CheckCircle2, Clock, ChevronRight, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { listProfileExtractTasks } from '../../api/client'
import { fmtDateTime } from '../../utils/time'
import { useProfileStore } from '../../stores/profileStore'
import { usePageTitle } from '../../hooks/usePageTitle'

type TaskStatus = 'pending' | 'running' | 'done' | 'error'

interface TaskCard {
  task_id: string
  competitor_id: string
  template_id: string
  status: TaskStatus
  current_step: string
  error: string
  created_at: string | null
  updated_at: string | null
  result: { id?: string } | null
}

const STATUS_META: Record<TaskStatus, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  pending: { label: '排队中', color: 'text-gray-600', bg: 'bg-gray-50', icon: Clock },
  running: { label: '执行中', color: 'text-blue-700', bg: 'bg-blue-50', icon: Loader2 },
  done: { label: '已完成', color: 'text-emerald-700', bg: 'bg-emerald-50', icon: CheckCircle2 },
  error: { label: '失败', color: 'text-red-700', bg: 'bg-red-50', icon: AlertCircle },
}

export default function ProfileTasksPage() {
  usePageTitle('画像任务')
  const navigate = useNavigate()

  // 从 store 读取竞品和模板列表（持久化，切换页面不丢失）
  const competitors = useProfileStore((s) => s.competitors)
  const templates = useProfileStore((s) => s.templates)

  // 任务列表：实时轮询，不需要持久化
  const [tasks, setTasks] = useState<TaskCard[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setError('')
    try {
      const t = await listProfileExtractTasks()
      // API 返回 status 为 string，cast 到 TaskStatus
      const mapped = t.map((task: any) => ({ ...task, status: task.status as TaskStatus }))
      setTasks(mapped as TaskCard[])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // 首次挂载加载；仅有活跃任务且页面可见时持续轮询。
  useEffect(() => {
    loadData()
  }, [loadData])

  const hasActiveTasks = tasks.some((task) => task.status === 'pending' || task.status === 'running')
  useEffect(() => {
    if (!hasActiveTasks) return
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadData()
    }, 3000)
    return () => clearInterval(interval)
  }, [hasActiveTasks, loadData])

  const getCompetitorName = (cid: string) => {
    const c = competitors.find((x) => x.id === cid)
    return c?.name || cid.slice(0, 8)
  }

  const getTemplateName = (tid: string) => {
    const t = templates.find((x) => x.id === tid)
    return t?.name || tid.slice(0, 8)
  }

  const handleCardClick = (task: TaskCard) => {
    if (task.status === 'done' && task.result?.id) {
      navigate(`/app/profiles/${task.result.id}`)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">画像提取任务</h1>
          <p className="mt-1 text-sm text-gray-500">查看竞品画像生成任务的实时状态</p>
        </div>
        <button
          onClick={loadData}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" />
          刷新
        </button>
      </div>

      {error && <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="mt-12 flex items-center justify-center gap-2 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载画像任务…
        </div>
      ) : tasks.length === 0 ? (
        <div className="mt-12 rounded-lg border border-dashed border-gray-300 py-12 text-center">
          <Globe className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-400">暂无画像提取任务</p>
          <p className="mt-1 text-xs text-gray-400">发起画像生成后，任务会显示在这里</p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {tasks.map((task) => {
            const meta = STATUS_META[task.status]
            const Icon = meta.icon
            const isRunning = task.status === 'running'

            return (
              <button
                type="button"
                key={task.task_id}
                onClick={() => handleCardClick(task)}
                disabled={task.status !== 'done' || !task.result?.id}
                className={`w-full rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm transition ${
                  task.status === 'done' ? 'cursor-pointer hover:border-blue-300 hover:shadow-md' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    {/* 头部：竞品 + 模板 + 状态 */}
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{getCompetitorName(task.competitor_id)}</h3>
                      <span className="text-xs text-gray-400">模板：{getTemplateName(task.template_id)}</span>
                    </div>

                    {/* 步骤进度 */}
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.bg} ${meta.color}`}>
                        <Icon className={`h-3.5 w-3.5 ${isRunning ? 'animate-spin' : ''}`} />
                        {meta.label}
                      </span>
                      {task.current_step && (
                        <span className="text-xs text-gray-500 truncate">{task.current_step}</span>
                      )}
                    </div>

                    {/* 错误信息 */}
                    {task.error && (
                      <p className="mt-2 text-xs text-red-600">{task.error}</p>
                    )}

                    {/* 时间 */}
                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                      {task.created_at && <span>创建：{fmtDateTime(task.created_at)}</span>}
                      {task.updated_at && <span>· 更新：{fmtDateTime(task.updated_at)}</span>}
                    </div>
                  </div>

                  {/* 操作 */}
                  {task.status === 'done' && (
                    <span
                      className="ml-4 inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
                    >
                      查看画像
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

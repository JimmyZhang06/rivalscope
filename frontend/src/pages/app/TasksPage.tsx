import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteResearch, listResearch } from '../../api/client'
import type { TaskBrief } from '../../api/types'
import StatusBadge from '../../components/StatusBadge'

const RUNNING = new Set(['pending', 'planning', 'searching', 'analyzing', 'reporting'])

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskBrief[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(() => {
    listResearch()
      .then(setTasks)
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 3000) // 轮询刷新列表状态
    return () => clearInterval(timer)
  }, [refresh])

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该调研任务？')) return
    await deleteResearch(id).catch(() => {})
    refresh()
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">调研记录</h1>
          <p className="mt-1 text-sm text-gray-500">全部历史调研任务与报告</p>
        </div>
        <Link
          to="/app/new"
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          ＋ 新建调研
        </Link>
      </div>

      <div className="mt-6">
        {!loaded ? (
          <p className="py-16 text-center text-sm text-gray-400">加载中…</p>
        ) : tasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center">
            <p className="text-sm text-gray-400">暂无调研任务</p>
            <Link to="/app/new" className="mt-2 inline-block text-sm text-blue-600 hover:underline">
              发起第一次调研 →
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow"
              >
                <Link to={`/app/tasks/${t.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-gray-900">{t.product_name}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="mt-1 truncate text-xs text-gray-500">
                    {t.competitors && <>竞品：{t.competitors} · </>}
                    {t.focus && <>重点：{t.focus} · </>}
                    {new Date(t.created_at).toLocaleString('zh-CN')}
                  </p>
                  {t.status === 'failed' && t.error && (
                    <p className="mt-1 truncate text-xs text-red-500">{t.error}</p>
                  )}
                </Link>
                {RUNNING.has(t.status) ? (
                  <span className="shrink-0 text-xs text-gray-400">进行中</span>
                ) : (
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                  >
                    删除
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { listAuditLogs, exportAuditLogs } from '../../api/client'
import type { AuditLog } from '../../api/types'
import { fmtDateTime } from '../../utils/time'

const PAGE_SIZE = 20

function Pagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
      <span>共 {total} 条</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(page - 1)} disabled={page <= 1} className="rounded border border-gray-200 px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">上一页</button>
        <span className="px-2">{page} / {totalPages}</span>
        <button onClick={() => onChange(page + 1)} disabled={page >= totalPages} className="rounded border border-gray-200 px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">下一页</button>
      </div>
    </div>
  )
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState('')
  const [resourceType, setResourceType] = useState('')
  const [userId, setUserId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listAuditLogs({
        action: action || undefined,
        resource_type: resourceType || undefined,
        user_id: userId || undefined,
        start: start || undefined,
        end: end || undefined,
        page,
        page_size: PAGE_SIZE,
      })
      setLogs(res.items as AuditLog[])
      setTotal(res.total)
    } catch {
      /* 静默失败 */
    } finally {
      setLoading(false)
    }
  }, [action, resourceType, userId, start, end, page])

  useEffect(() => {
    load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const resetAndLoad = (setter: (v: string) => void, value: string) => {
    setter(value)
    setPage(1)
  }

  const handleExport = async () => {
    try {
      const blob = await exportAuditLogs({
        action: action || undefined,
        resource_type: resourceType || undefined,
        user_id: userId || undefined,
        start: start || undefined,
        end: end || undefined,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('导出失败:', err)
      alert(err instanceof Error ? err.message : '导出失败')
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">审计日志</h1>
      <p className="mt-1 text-sm text-gray-500">系统操作记录、LLM 调用与来源访问</p>

      {/* 筛选栏 */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">操作类型</label>
            <input
              value={action}
              onChange={(e) => resetAndLoad(setAction, e.target.value)}
              placeholder="如 llm.call"
              className="w-44 rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">资源类型</label>
            <input
              value={resourceType}
              onChange={(e) => resetAndLoad(setResourceType, e.target.value)}
              placeholder="如 research_task"
              className="w-44 rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">用户 ID</label>
            <input
              value={userId}
              onChange={(e) => resetAndLoad(setUserId, e.target.value)}
              placeholder="用户 ID"
              className="w-40 rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">开始时间</label>
            <input
              type="date"
              value={start}
              onChange={(e) => resetAndLoad(setStart, e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">结束时间</label>
            <input
              type="date"
              value={end}
              onChange={(e) => resetAndLoad(setEnd, e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={load}
            className="self-end rounded-md border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50"
          >
            刷新
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 self-end rounded-md border border-blue-200 bg-blue-50 px-4 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            <Download className="h-3.5 w-3.5" />
            导出 CSV
          </button>
        </div>
      </div>

      {/* 日志表格 */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <p className="p-8 text-center text-sm text-gray-400">加载中…</p>
        ) : logs.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-400">暂无日志</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-gray-500">
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">时间</th>
                  <th className="px-3 py-2.5 font-medium">操作用户</th>
                  <th className="px-3 py-2.5 font-medium">组织</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">操作</th>
                  <th className="px-3 py-2.5 font-medium">资源</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">状态</th>
                  <th className="px-3 py-2.5 font-medium">模型</th>
                  <th className="px-3 py-2.5 font-medium text-right">Token</th>
                  <th className="px-3 py-2.5 font-medium">错误</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50/60">
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                      {fmtDateTime(log.created_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-gray-700">{log.user_id.slice(0, 8)}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {log.org_id ? (
                        <span className="font-mono text-gray-500">{log.org_id.slice(0, 8)}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-gray-700">{log.action}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-gray-600">{log.resource_type}</span>
                      {log.resource_id && (
                        <span className="ml-1 font-mono text-gray-400">/{log.resource_id.slice(0, 8)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-1.5 py-0.5 ${log.status === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500">
                      {log.model_name || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-500">
                      {(log.tokens_prompt + log.tokens_completion) > 0
                        ? `${(log.tokens_prompt + log.tokens_completion).toLocaleString()}`
                        : '—'}
                    </td>
                    <td className="max-w-xs truncate px-3 py-2.5 text-gray-400" title={log.error}>
                      {log.error || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
    </div>
  )
}

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import type { TrackerRun } from '../api/types'
import { parseUtc } from '../utils/time'
import StatusBadge from './StatusBadge'

/** 追踪详情页的单期运行记录（时间线节点） */
export default function RunHistoryItem({
  run,
  period,
  isLast,
}: {
  run: TrackerRun
  period: number
  isLast: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = run.change_summary.trim()
  const long = summary.length > 160

  return (
    <li className="relative flex gap-4 pb-8">
      {/* 时间线竖线与节点 */}
      {!isLast && <span className="absolute left-[15px] top-8 h-full w-px bg-gray-200" aria-hidden />}
      <span
        className={`z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          run.status === 'completed'
            ? 'bg-blue-100 text-blue-700'
            : run.status === 'failed'
              ? 'bg-red-100 text-red-600'
              : 'bg-cyan-100 text-cyan-700'
        }`}
      >
        {period}
      </span>

      <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">第 {period} 期</span>
          <StatusBadge status={run.status} />
          <span className="text-xs text-gray-400">{parseUtc(run.created_at).toLocaleString('zh-CN')}</span>
          <span className="flex-1" />
          {run.status === 'completed' && (
            <Link to={`/app/tasks/${run.id}`} className="text-xs font-medium text-blue-700 hover:underline">
              查看完整报告 →
            </Link>
          )}
        </div>

        {run.status === 'failed' && run.error && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{run.error}</p>
        )}

        {summary && (
          <div className="mt-3 rounded-md bg-blue-50/60 px-4 py-3">
            <div
              className={`prose prose-sm max-w-none text-[13px] leading-relaxed text-gray-700 prose-headings:my-1.5 prose-headings:text-sm prose-p:my-1 prose-ul:my-1 ${
                !expanded && long ? 'max-h-24 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]' : ''
              }`}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
            </div>
            {long && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 text-xs font-medium text-blue-700 hover:underline"
              >
                {expanded ? '收起' : '展开全部变更'}
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

import { useState } from 'react'
import type { Source } from '../api/types'
import TierBadge from './TierBadge'

function faviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`
}

/** 按距今天数返回新鲜度徽标（无日期返回 null） */
function freshnessBadge(ageDays: number) {
  if (ageDays < 0) return null
  if (ageDays <= 30) return { dot: 'bg-emerald-500', label: '最新', cls: 'bg-emerald-50 text-emerald-600' }
  if (ageDays <= 180) return { dot: 'bg-blue-500', label: '较新', cls: 'bg-blue-50 text-blue-700' }
  if (ageDays <= 365) return { dot: 'bg-gray-400', label: '一般', cls: 'bg-gray-100 text-gray-500' }
  return { dot: 'bg-orange-400', label: '较旧', cls: 'bg-orange-50 text-orange-600' }
}

export default function SourceCard({
  source,
  index,
  onOpenDetail,
}: {
  source: Source
  index: number
  onOpenDetail: (source: Source) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const pct = Math.round(Math.min(Math.max(source.score, 0), 1) * 100)
  const fresh = freshnessBadge(source.age_days)

  return (
    <div id={`source-${index}`} className="rounded-lg border border-gray-200 bg-white p-4 transition hover:border-blue-200 hover:shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {source.domain && (
              <img
                src={faviconUrl(source.domain)}
                alt=""
                className="h-4 w-4 shrink-0 rounded-sm"
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            )}
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline"
              title={source.title || source.url}
            >
              {source.title || source.url}
            </a>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <TierBadge tier={source.tier} />
            {source.dimension && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{source.dimension}</span>
            )}
            {source.published_at && <span>{source.published_at.slice(0, 10)}</span>}
            {fresh && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${fresh.cls}`}
                title={`距今 ${source.age_days} 天`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${fresh.dot}`} /> {fresh.label}
              </span>
            )}
            {source.domain && <span className="truncate">{source.domain}</span>}
          </div>
          {/* 相关度条 */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-gray-400">相关度</span>
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-gray-500">{pct}%</span>
          </div>
          {/* 置信度条 — 始终显示，0% 时灰色空条 */}
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-xs text-gray-400">可信度</span>
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full ${
                  source.confidence > 0
                    ? source.confidence >= 0.7
                      ? 'bg-emerald-500'
                      : source.confidence >= 0.4
                        ? 'bg-amber-400'
                        : 'bg-red-400'
                    : 'bg-transparent'
                }`}
                style={{ width: `${Math.round(source.confidence * 100)}%` }}
              />
            </div>
            <span className="text-xs text-gray-500">{Math.round(source.confidence * 100)}%</span>
          </div>
          {source.is_duplicate && (
            <span className="mt-1.5 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">转载</span>
          )}
          {source.conflict_status === 'pending' && (
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-600" title="该维度存在多个来源，需人工复核一致性">⚠ 待复核</span>
          )}
          {source.snippet && (
            <p
              className={`mt-2 text-xs leading-relaxed text-gray-500 ${expanded ? '' : 'line-clamp-2'} cursor-pointer`}
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? '收起' : '展开'}
            >
              {source.snippet}
            </p>
          )}
          <div className="mt-2 flex gap-3">
            <button
              onClick={() => onOpenDetail(source)}
              className="text-xs font-medium text-blue-700 hover:text-blue-800"
            >
              查看原文摘录 →
            </button>
            <a href={source.url} target="_blank" rel="noreferrer" className="text-xs text-gray-400 hover:text-gray-600">
              访问原网页 ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

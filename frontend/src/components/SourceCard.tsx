import { useState } from 'react'
import type { Source } from '../api/types'
import TierBadge from './TierBadge'

function faviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`
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

  return (
    <div id={`source-${index}`} className="rounded-xl border border-gray-200 bg-white p-4 transition hover:border-blue-200 hover:shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-600">
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
              className="text-xs font-medium text-blue-600 hover:text-blue-700"
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

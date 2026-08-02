import { useEffect, useState } from 'react'
import { getSourceDetail } from '../api/client'
import type { Source, SourceDetail } from '../api/types'
import TierBadge from './TierBadge'

/** 右侧滑出抽屉：来源完整信息 + 原文摘录阅读模式（懒加载详情接口） */
export default function SourceDrawer({
  taskId,
  source,
  index,
  onClose,
}: {
  taskId: string
  source: Source | null
  index: number
  onClose: () => void
}) {
  const [detail, setDetail] = useState<SourceDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [shown, setShown] = useState(false)

  // 进场动画：挂载后下一帧滑入（用 setTimeout，后台标签页 rAF 会被暂停）
  useEffect(() => {
    if (!source) {
      setShown(false)
      setDetail(null)
      return
    }
    const timer = setTimeout(() => setShown(true), 20)
    let cancelled = false
    setLoading(true)
    getSourceDetail(taskId, source.id)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch(() => {
        if (!cancelled) setDetail(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      clearTimeout(timer)
      cancelled = true
    }
  }, [taskId, source])

  // 退场动画：先滑出再卸载
  const close = () => {
    setShown(false)
    setTimeout(onClose, 300)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  if (!source) return null
  const pct = Math.round(Math.min(Math.max(source.score, 0), 1) * 100)

  return (
    <div className="no-print fixed inset-0 z-50">
      {/* 遮罩 */}
      <div
        className={`absolute inset-0 bg-gray-900/40 transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={close}
      />
      {/* 面板 */}
      <div
        className={`absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between border-b border-gray-100 p-5">
          <div className="min-w-0 pr-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-600">
                {index}
              </span>
              <TierBadge tier={source.tier} />
              {source.dimension && (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{source.dimension}</span>
              )}
            </div>
            <h2 className="mt-2 text-base font-semibold leading-snug text-gray-900">{source.title || source.url}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-gray-500">
              {source.domain && <span>{source.domain}</span>}
              {source.published_at && <span>发布于 {source.published_at.slice(0, 10)}</span>}
              <span>相关度 {pct}%</span>
              {source.confidence > 0 && <span>可信度 {Math.round(source.confidence * 100)}%</span>}
              {source.access_status === 'failed' && (
                <span className="text-amber-600">快照获取失败</span>
              )}
              {source.access_status === '' && !loading && (
                <span className="text-gray-400">快照加载中…</span>
              )}
            </div>
          </div>
          <button
            onClick={close}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {source.snippet && (
            <div className="rounded-lg bg-blue-50/60 p-3 text-sm leading-relaxed text-gray-700">{source.snippet}</div>
          )}
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">原文摘录</h3>
          {loading ? (
            <p className="mt-3 text-sm text-gray-400">加载中…</p>
          ) : detail?.raw_content ? (
            <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-700">{detail.raw_content}</div>
          ) : (
            <p className="mt-3 text-sm text-gray-400">该来源暂无原文摘录，可点击下方按钮访问原网页。</p>
          )}
        </div>

        <div className="border-t border-gray-100 p-4">
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="block w-full rounded-lg bg-blue-600 py-2.5 text-center text-sm font-medium text-white hover:bg-blue-700"
          >
            访问原网页 ↗
          </a>
        </div>
      </div>
    </div>
  )
}

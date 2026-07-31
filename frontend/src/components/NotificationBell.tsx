import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Inbox } from 'lucide-react'
import { getUnreadCount, listNotifications, markNotificationsRead } from '../api/client'
import type { NotificationItem } from '../api/types'

/** 相对时间：刚刚 / n 分钟前 / n 小时前 / 日期 */
function timeAgo(iso: string) {
  const t = new Date(/Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`).getTime()
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(t).toLocaleDateString('zh-CN')
}

/** 站内通知铃铛：未读红点 + 下拉最近通知，30s 轮询未读数 */
export default function NotificationBell() {
  const navigate = useNavigate()
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const refreshCount = useCallback(() => {
    getUnreadCount()
      .then((r) => setCount(r.count))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshCount()
    const timer = setInterval(refreshCount, 30_000)
    return () => clearInterval(timer)
  }, [refreshCount])

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const handleToggle = async () => {
    const next = !open
    setOpen(next)
    if (next) {
      setLoading(true)
      try {
        setItems(await listNotifications())
      } catch {
        // 忽略加载失败，保持空列表
      } finally {
        setLoading(false)
      }
    }
  }

  const handleClick = async (n: NotificationItem) => {
    setOpen(false)
    if (!n.read) {
      try {
        await markNotificationsRead(n.id)
      } catch {
        // 标记失败不阻断跳转
      }
      refreshCount()
    }
    if (n.link) navigate(n.link)
  }

  const handleReadAll = async () => {
    try {
      await markNotificationsRead()
      setItems((prev) => prev.map((n) => ({ ...n, read: true })))
      setCount(0)
    } catch {
      // 忽略
    }
  }

  return (
    <div ref={ref} className="fixed right-6 top-5 z-30">
      <button
        onClick={handleToggle}
        aria-label="站内通知"
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-96 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">通知{count > 0 && `（${count} 条未读）`}</h3>
            {count > 0 && (
              <button onClick={handleReadAll} className="text-xs font-medium text-blue-600 hover:underline">
                全部已读
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <p className="py-10 text-center text-sm text-gray-400">加载中…</p>
            ) : items.length === 0 ? (
              <div className="py-10 text-center">
                <Inbox className="mx-auto h-7 w-7 text-gray-300" />
                <p className="mt-2 text-sm text-gray-400">暂无通知</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => handleClick(n)}
                      className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-blue-50/60 ${
                        n.read ? 'opacity-60' : ''
                      }`}
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-blue-500'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900">{n.title}</span>
                        {n.body && <span className="mt-0.5 block truncate text-xs text-gray-500">{n.body}</span>}
                        <span className="mt-1 block text-xs text-gray-400">{timeAgo(n.created_at)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

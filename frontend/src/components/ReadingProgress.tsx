import { useEffect, useState } from 'react'

/** 顶部阅读进度条（随页面滚动百分比） */
export default function ReadingProgress() {
  const [pct, setPct] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement
      const total = el.scrollHeight - el.clientHeight
      setPct(total > 0 ? Math.min((el.scrollTop / total) * 100, 100) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="no-print fixed inset-x-0 top-0 z-50 h-[3px] bg-transparent">
      <div
        className="h-full rounded-r-full bg-blue-600 transition-[width] duration-150"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

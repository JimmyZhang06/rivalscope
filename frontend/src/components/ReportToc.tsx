import { useEffect, useMemo, useState } from 'react'

export interface TocItem {
  id: string
  text: string
  level: number
}

/** 与 ReportView 中标题 id 保持一致的 slug 规则 */
export function slugify(text: string) {
  return `sec-${text
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')}`
}

/** 从 markdown 提取 ##/### 标题 */
export function extractToc(markdown: string): TocItem[] {
  const items: TocItem[] = []
  let inCode = false
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const m = /^(#{1,3})\s+(.+)$/.exec(line)
    if (m) {
      const text = m[2].replace(/\[(\d+)\]/g, '').trim()
      items.push({ id: slugify(text), text, level: m[1].length })
    }
  }
  return items
}

export default function ReportToc({ markdown }: { markdown: string }) {
  const items = useMemo(() => extractToc(markdown), [markdown])
  const [activeId, setActiveId] = useState('')

  useEffect(() => {
    if (items.length === 0) return
    const onScroll = () => {
      let current = items[0]?.id ?? ''
      for (const item of items) {
        const el = document.getElementById(item.id)
        if (el && el.getBoundingClientRect().top <= 120) current = item.id
      }
      setActiveId(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [items])

  if (items.length === 0) return null

  return (
    <nav className="no-print sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
        </svg>
        本页目录
      </p>
      <ul className="mt-3 space-y-0.5 border-l-2 border-gray-100">
        {items.map((item, i) => (
          <li key={`${item.id}-${i}`}>
            <a
              href={`#${item.id}`}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              className={`-ml-0.5 block border-l-2 py-1 pr-1 text-xs leading-snug transition ${
                item.level >= 3 ? 'pl-6' : 'pl-3.5'
              } ${
                activeId === item.id
                  ? 'border-blue-500 font-medium text-blue-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-900'
              }`}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

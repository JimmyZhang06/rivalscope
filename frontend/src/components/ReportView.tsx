import { useMemo } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Source } from '../api/types'
import { splitSourcesSection } from '../utils/reportSections'
import { slugify } from './ReportToc'
import TierBadge from './TierBadge'

/** 把正文中的 [12] 引用（排除 markdown 链接语法）转为可点击角标链接 */
function injectCitations(markdown: string) {
  return markdown.replace(/\[(\d+)\](?!\()/g, '[[$1]](#cite-$1)')
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return nodeText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

function heading(Tag: 'h1' | 'h2' | 'h3') {
  return ({ children }: { children?: ReactNode }) => {
    const text = nodeText(children).replace(/\[(\d+)\]/g, '').trim()
    return (
      <Tag id={slugify(text)} className="scroll-mt-24">
        {children}
      </Tag>
    )
  }
}

/** 引用角标：点击开抽屉，hover 弹出来源气泡 */
function CiteSup({ n, source, onCite }: { n: number; source?: Source; onCite?: (n: number) => void }) {
  return (
    <sup className="group/cite relative inline-block">
      <button
        onClick={() => onCite?.(n)}
        className="cite-sup mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-blue-50 px-1 align-super text-[10px] font-semibold text-blue-600 transition hover:bg-blue-600 hover:text-white"
      >
        {n}
      </button>
      {source && (
        <span className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-1.5 w-60 -translate-x-1/2 rounded-lg bg-gray-900 p-2.5 text-left opacity-0 shadow-xl transition-all duration-150 group-hover/cite:visible group-hover/cite:opacity-100">
        <span className="block truncate text-[11px] font-medium leading-snug text-white">
            {source.title || source.url}
          </span>
          <span className="mt-1.5 flex items-center gap-1.5">
            <TierBadge tier={source.tier} />
            {source.domain && <span className="truncate text-[10px] text-gray-400">{source.domain}</span>}
          </span>
          <span className="absolute left-1/2 top-full -ml-1 border-4 border-transparent border-t-gray-900" />
        </span>
      )}
    </sup>
  )
}

export default function ReportView({
  markdown,
  sources,
  onCite,
}: {
  markdown: string
  sources?: Source[]
  onCite?: (index: number) => void
}) {
  // LLM 生成的「信息来源」章节是大段裸 URL 混排，剥离后改用结构化 sources 渲染
  const { body, sourcesTitle } = useMemo(
    () => (sources && sources.length > 0 ? splitSourcesSection(markdown) : { body: markdown, sourcesTitle: null }),
    [markdown, sources],
  )
  const processed = useMemo(() => (onCite ? injectCitations(body) : body), [body, onCite])

  return (
    <div className="report-md text-sm text-gray-800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: heading('h1'),
          h2: heading('h2'),
          h3: heading('h3'),
          table: ({ children }) => (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children, ...props }) => {
            const m = href?.match(/^#cite-(\d+)$/)
            if (m) {
              const n = Number(m[1])
              return <CiteSup n={n} source={sources?.[n - 1]} onCite={onCite} />
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            )
          },
        }}
      >
        {processed}
      </ReactMarkdown>
      {sources && sources.length > 0 && (
        <section className="mt-2">
          <h2 id={slugify(sourcesTitle ?? '信息来源')} className="scroll-mt-24">
            {sourcesTitle ?? '信息来源'}
          </h2>
          <div className="not-prose mt-4 grid gap-2.5 sm:grid-cols-2">
            {sources.map((s, i) => (
              <button
                key={s.id}
                onClick={() => onCite?.(i + 1)}
                className="group flex items-start gap-2.5 rounded-xl border border-gray-100 bg-gray-50/60 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/40 hover:shadow-sm"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-600 transition group-hover:bg-blue-600 group-hover:text-white">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium leading-snug text-gray-800 group-hover:text-blue-700">
                    {s.title || s.url}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
                    <TierBadge tier={s.tier} />
                    {s.domain && <span className="truncate">{s.domain}</span>}
                    {s.published_at && <span className="shrink-0">{s.published_at.slice(0, 10)}</span>}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

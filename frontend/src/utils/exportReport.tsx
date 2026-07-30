import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import html2pdf from 'html2pdf.js'
import type { Source, TaskDetail } from '../api/types'
import { TIER_LABELS } from '../components/TierBadge'
import { splitSourcesSection } from './reportSections'

/**
 * 独立导出模板：封面 + 报告正文 + 来源附录。
 * 与页面 DOM（目录/Tab/抽屉等）完全解耦，导出结果不受页面布局影响。
 */

const EXPORT_CSS = `
  .exp-root { font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif; color: #1f2937; font-size: 14px; line-height: 1.9; overflow-wrap: break-word; }
  .exp-cover { border-bottom: 3px solid #2563eb; padding-bottom: 18px; margin-bottom: 24px; }
  .exp-cover .exp-kicker { font-size: 11px; letter-spacing: 3px; color: #2563eb; text-transform: uppercase; margin: 0; }
  .exp-cover h1 { font-size: 26px; color: #111827; margin: 8px 0 10px; }
  .exp-cover .exp-meta { font-size: 12px; color: #6b7280; margin: 2px 0; }
  .exp-body h1 { display: none; }
  .exp-body h2 { font-size: 19px; color: #111827; border-left: 4px solid #2563eb; padding-left: 10px; margin: 26px 0 12px; }
  .exp-body h3 { font-size: 16px; color: #1f2937; margin: 18px 0 8px; }
  .exp-body p { margin: 8px 0; }
  .exp-body strong { color: #1e3a8a; }
  .exp-body ul, .exp-body ol { margin: 8px 0; padding-left: 24px; }
  .exp-body li { margin: 4px 0; }
  .exp-body blockquote { background: #eff6ff; border-left: 3px solid #60a5fa; padding: 8px 14px; margin: 10px 0; color: #4b5563; }
  .exp-body table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 11px; line-height: 1.7; margin: 12px 0; }
  .exp-body th, .exp-body td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; word-break: break-word; overflow-wrap: break-word; }
  .exp-body thead th { background: #eff6ff; color: #1e3a8a; }
  .exp-body a { color: #2563eb; text-decoration: none; word-break: break-all; }
  .exp-body pre { white-space: pre-wrap; word-break: break-word; background: #f3f4f6; border-radius: 4px; padding: 10px 12px; font-size: 11px; }
  .exp-body code { font-family: Consolas, "Courier New", monospace; font-size: 12px; }
  .exp-body hr { border: none; border-top: 1px solid #e5e7eb; margin: 22px 0; }
  .exp-sources { margin-top: 30px; border-top: 3px solid #2563eb; padding-top: 14px; }
  .exp-sources h2 { font-size: 19px; color: #111827; margin: 0 0 12px; }
  .exp-source { font-size: 12px; margin: 0 0 10px; }
  .exp-source .exp-src-title { color: #111827; font-weight: 600; }
  .exp-source .exp-src-meta { color: #6b7280; margin-top: 2px; }
  .exp-source .exp-src-url { color: #2563eb; word-break: break-all; }
`

/**
 * 分页规则仅注入 PDF（html2pdf 的 css 分页模式）。
 * 不能给 Word 用：Word 的 HTML 引擎会把 div 上的 page-break-inside/after
 * 错误解释为段落分页属性，导致来源附录每条独占一页。
 */
const PDF_PAGEBREAK_CSS = `
  .exp-body h2, .exp-body h3 { page-break-after: avoid; }
  .exp-body tr { page-break-inside: avoid; }
  .exp-body pre { page-break-inside: avoid; }
  .exp-sources { page-break-before: always; }
  .exp-source { page-break-inside: avoid; }
`

/**
 * Word 手动分页符：Word 的 HTML 引擎对 CSS page-break-* 支持不可靠
 * （div 上的规则触发位置错乱），须用 Word 另存 HTML 时自带的专用标记。
 */
const WORD_PAGE_BREAK = `<br clear="all" style="mso-special-character:line-break;page-break-before:always">`

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 报告正文 markdown → 静态 HTML（剥离原始来源章节，由格式化附录替代；引用 [n] 保留为纯文本角标） */
function renderBodyHtml(markdown: string) {
  const { body } = splitSourcesSection(markdown)
  // 首个 h1 与封面标题重复，直接从 HTML 移除（Word 不支持 display:none，不能靠 CSS 隐藏）
  return renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>).replace(
    /<h1[\s\S]*?<\/h1>/,
    '',
  )
}

function renderCoverHtml(task: TaskDetail, sources: Source[]) {
  const competitors = task.competitors
    ? task.competitors
        .split(/[,，、]/)
        .map((c) => c.trim())
        .filter(Boolean)
        .join('、')
    : ''
  return `
    <div class="exp-cover">
      <p class="exp-kicker">Competitive Research Report</p>
      <h1>${escapeHtml(task.product_name)} 竞品调研报告</h1>
      ${competitors ? `<p class="exp-meta">对比竞品：${escapeHtml(competitors)}</p>` : ''}
      ${task.focus ? `<p class="exp-meta">调研重点：${escapeHtml(task.focus)}</p>` : ''}
      <p class="exp-meta">生成时间：${new Date(task.created_at).toLocaleString('zh-CN')} · 信息来源 ${sources.length} 条</p>
    </div>`
}

function renderSourcesHtml(sources: Source[]) {
  if (sources.length === 0) return ''
  const items = sources
    .map((s, i) => {
      const meta = [
        TIER_LABELS[s.tier] ?? '其他',
        s.dimension,
        s.published_at ? s.published_at.slice(0, 10) : '',
        s.domain,
      ]
        .filter(Boolean)
        .join(' · ')
      return `
        <div class="exp-source">
          <div class="exp-src-title">[${i + 1}] ${escapeHtml(s.title || s.url)}</div>
          <div class="exp-src-meta">${escapeHtml(meta)}</div>
          <div class="exp-src-url">${escapeHtml(s.url)}</div>
        </div>`
    })
    .join('')
  return `<div class="exp-sources"><h2>附录：信息来源（${sources.length}）</h2>${items}</div>`
}

/** 组装完整导出 HTML 片段（不含目录等页面元素）；pageBreak 为插在来源附录前的分页标记 */
function buildExportHtml(task: TaskDetail, sources: Source[], pageBreak = '') {
  return `<div class="exp-root">${renderCoverHtml(task, sources)}<div class="exp-body">${renderBodyHtml(
    task.report_markdown,
  )}</div>${sources.length > 0 ? pageBreak : ''}${renderSourcesHtml(sources)}</div>`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 下载 Markdown 源文件 */
export function exportMarkdown(task: TaskDetail) {
  downloadBlob(
    new Blob([task.report_markdown], { type: 'text/markdown;charset=utf-8' }),
    `竞品调研报告-${task.product_name}.md`,
  )
}

/** 下载 Word（.doc，Word/WPS 直接打开的 HTML 文档） */
export function exportWord(task: TaskDetail, sources: Source[]) {
  // Word 打开 HTML 文档默认进入 Web 版式（内容随窗口铺满、无页面边距），
  // 需通过 mso 私有声明强制页面视图，并用 @page Section1 定义 A4 纸张与页边距
  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(task.product_name)} 竞品调研报告</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>
@page Section1 { size: 595.3pt 841.9pt; margin: 2cm 1.8cm 2cm 1.8cm; mso-header-margin: 36pt; mso-footer-margin: 36pt; mso-paper-source: 0; }
div.Section1 { page: Section1; }
${EXPORT_CSS}</style></head>
<body><div class="Section1">${buildExportHtml(task, sources, WORD_PAGE_BREAK)}</div></body></html>`
  downloadBlob(new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' }), `竞品调研报告-${task.product_name}.doc`)
}

/** 下载 PDF（html2pdf 离屏渲染独立模板，A4 纵向） */
export async function exportPdf(task: TaskDetail, sources: Source[]) {
  // 偏移样式只能放在外层 wrapper 上：html2pdf 会连同内联样式克隆目标元素，
  // 若目标自身带 fixed/left:-10000px，克隆体也会偏移出画布导致 PDF 全白
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'position:fixed;left:-10000px;top:0;'
  const content = document.createElement('div')
  // 宽度须等于 A4 内容区宽 (210-12-12)mm ≈ 703px：html2pdf 的渲染容器按去除页边距后的
  // 宽度布局，content 若按整页 794px 设置会超出容器 91px，右侧内容被整体截断
  content.style.cssText = 'width:703px;background:#fff;'
  content.innerHTML = `<style>${EXPORT_CSS}${PDF_PAGEBREAK_CSS}</style>${buildExportHtml(task, sources)}`
  wrapper.appendChild(content)
  document.body.appendChild(wrapper)
  // pagebreak 为运行时支持选项，官方类型声明未收录，故提为变量绕过字面量检查
  // imageTimeout：导出模板不含外部图片，快速跳过页面上其他图片（如来源 favicon）的克隆等待
  const options = {
    margin: [12, 12, 14, 12] as [number, number, number, number],
    filename: `竞品调研报告-${task.product_name}.pdf`,
    image: { type: 'jpeg' as const, quality: 0.95 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      imageTimeout: 1500,
      ignoreElements: (el: Element) => el.tagName === 'IMG' && !wrapper.contains(el),
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
    pagebreak: { mode: ['css', 'legacy'] },
  }
  try {
    await html2pdf().set(options).from(content).save()
  } finally {
    wrapper.remove()
  }
}

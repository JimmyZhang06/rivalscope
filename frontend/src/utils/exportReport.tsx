import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Source, TaskDetail } from '../api/types'
import { TIER_LABELS } from '../components/TierBadge'
import { fmtDateTime } from './time'
import { splitSourcesSection } from './reportSections'

/**
 * Normalized report shape shared by TaskDetail and ProfileReport:
 * { report_markdown, product_name, created_at?, competitors?, focus? }
 */
export interface ReportExportInput {
  report_markdown: string
  product_name: string
  created_at?: string
  competitors?: string
  focus?: string
}

/**
 * 独立导出模板：封面 + 报告正文 + 来源附录。
 * 与页面 DOM（目录/Tab/抽屉等）完全解耦，导出结果不受页面布局影响。
 */

const EXPORT_CSS = `
  .exp-root { font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif; color: #1f2937; font-size: 14px; line-height: 1.9; overflow-wrap: break-word; }
  .exp-cover { border-bottom: 3px solid #1e40af; padding-bottom: 18px; margin-bottom: 24px; }
  .exp-cover .exp-kicker { font-size: 11px; letter-spacing: 3px; color: #1e40af; text-transform: uppercase; margin: 0; }
  .exp-cover h1 { font-size: 26px; color: #111827; margin: 8px 0 10px; }
  .exp-cover .exp-meta { font-size: 12px; color: #6b7280; margin: 2px 0; }
  .exp-body h1 { display: none; }
  .exp-body h2 { font-size: 19px; color: #111827; border-left: 4px solid #1e40af; padding-left: 10px; margin: 26px 0 12px; }
  .exp-body h3 { font-size: 16px; color: #1f2937; margin: 18px 0 8px; }
  .exp-body p { margin: 8px 0; }
  .exp-body strong { color: #1e3a8a; }
  .exp-body ul, .exp-body ol { margin: 8px 0; padding-left: 24px; }
  .exp-body li { margin: 4px 0; }
  .exp-body blockquote { background: #eff6ff; border-left: 3px solid #60a5fa; padding: 8px 14px; margin: 10px 0; color: #4b5563; }
  .exp-body table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 11px; line-height: 1.7; margin: 12px 0; }
  .exp-body th, .exp-body td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; word-break: break-word; overflow-wrap: break-word; }
  .exp-body thead th { background: #eff6ff; color: #1e3a8a; }
  .exp-body a { color: #1d4ed8; text-decoration: none; word-break: break-all; }
  .exp-body pre { white-space: pre-wrap; word-break: break-word; background: #f3f4f6; border-radius: 4px; padding: 10px 12px; font-size: 11px; }
  .exp-body code { font-family: Consolas, "Courier New", monospace; font-size: 12px; }
  .exp-body hr { border: none; border-top: 1px solid #e5e7eb; margin: 22px 0; }
  .exp-sources { margin-top: 30px; border-top: 3px solid #1e40af; padding-top: 14px; }
  .exp-sources h2 { font-size: 19px; color: #111827; margin: 0 0 12px; }
  .exp-source { font-size: 12px; margin: 0 0 10px; }
  .exp-source .exp-src-title { color: #111827; font-weight: 600; }
  .exp-source .exp-src-meta { color: #6b7280; margin-top: 2px; }
  .exp-source .exp-src-url { color: #1d4ed8; word-break: break-all; }
`

const PDF_PAGEBREAK_CSS = `
  .exp-body h2, .exp-body h3 { page-break-after: avoid; }
  .exp-body tr { page-break-inside: avoid; }
  .exp-body pre { page-break-inside: avoid; }
  .exp-sources { page-break-before: always; }
  .exp-source { page-break-inside: avoid; }
`

const WORD_PAGE_BREAK = `<br clear="all" style="mso-special-character:line-break;page-break-before:always">`

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderBodyHtml(markdown: string) {
  const { body } = splitSourcesSection(markdown)
  return renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>).replace(
    /<h1[\s\S]*?<\/h1>/,
    '',
  )
}

function renderCoverHtml(input: ReportExportInput, sources: Source[]) {
  const competitors = input.competitors
    ? input.competitors.split(/[,，、]/).map((c) => c.trim()).filter(Boolean).join('、')
    : ''
  return `
    <div class="exp-cover">
      <p class="exp-kicker">Competitive Intelligence Profile Report</p>
      <h1>${escapeHtml(input.product_name)} 竞品画像报告</h1>
      ${competitors ? `<p class="exp-meta">对比竞品：${escapeHtml(competitors)}</p>` : ''}
      ${input.focus ? `<p class="exp-meta">调研重点：${escapeHtml(input.focus)}</p>` : ''}
      <p class="exp-meta">生成时间：${fmtDateTime(input.created_at || '')} · 信息来源 ${sources.length} 条</p>
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
      ].filter(Boolean).join(' · ')
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

function buildExportHtml(input: ReportExportInput, sources: Source[], pageBreak = '') {
  return `<div class="exp-root">${renderCoverHtml(input, sources)}<div class="exp-body">${renderBodyHtml(
    input.report_markdown,
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
export function exportMarkdown(input: ReportExportInput) {
  downloadBlob(
    new Blob([input.report_markdown], { type: 'text/markdown;charset=utf-8' }),
    `竞品画像报告-${input.product_name}.md`,
  )
}

/** 下载 Word（.doc） */
export function exportWord(input: ReportExportInput, sources: Source[]) {
  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(input.product_name)} 竞品画像报告</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>
@page Section1 { size: 595.3pt 841.9pt; margin: 2cm 1.8cm 2cm 1.8cm; mso-header-margin: 36pt; mso-footer-margin: 36pt; mso-paper-source: 0; }
div.Section1 { page: Section1; }
${EXPORT_CSS}</style></head>
<body><div class="Section1">${buildExportHtml(input, sources, WORD_PAGE_BREAK)}</div></body></html>`
  downloadBlob(new Blob(['﻿', html], { type: 'application/msword;charset=utf-8' }), `竞品画像报告-${input.product_name}.doc`)
}

async function buildPdfWorker(input: ReportExportInput, sources: Source[]) {
  const { default: html2pdf } = await import('html2pdf.js')
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'position:fixed;left:-10000px;top:0;'
  const content = document.createElement('div')
  content.style.cssText = 'width:703px;background:#fff;'
  content.innerHTML = `<style>${EXPORT_CSS}${PDF_PAGEBREAK_CSS}</style>${buildExportHtml(input, sources)}`
  wrapper.appendChild(content)
  document.body.appendChild(wrapper)
  const options = {
    margin: [12, 12, 14, 12] as [number, number, number, number],
    filename: `竞品画像报告-${input.product_name}.pdf`,
    image: { type: 'jpeg' as const, quality: 0.95 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      imageTimeout: 1500,
      ignoreElements: (el: Element) => el.tagName === 'IMG' && !wrapper.contains(el),
    },
    jsPDF: { unit: 'mm', format: 'a4' as const, orientation: 'portrait' as const },
    pagebreak: { mode: ['css', 'legacy'] as any },
  }
  return { worker: html2pdf().set(options).from(content), cleanup: () => wrapper.remove() }
}

/** 下载 PDF */
export async function exportPdf(input: ReportExportInput, sources: Source[]) {
  const { worker, cleanup } = await buildPdfWorker(input, sources)
  try {
    await worker.save()
  } finally {
    cleanup()
  }
}

/** 生成 PDF 的 Blob */
export async function buildReportPdfBlob(input: ReportExportInput, sources: Source[]): Promise<Blob> {
  const { worker, cleanup } = await buildPdfWorker(input, sources)
  try {
    return await (worker as unknown as { outputPdf: (t: string) => Promise<Blob> }).outputPdf('blob')
  } finally {
    cleanup()
  }
}

// ---------- 向下兼容：TaskDetail 版本 ----------

export function exportMarkdownTask(task: TaskDetail) {
  downloadBlob(
    new Blob([task.report_markdown], { type: 'text/markdown;charset=utf-8' }),
    `竞品调研报告-${task.product_name}.md`,
  )
}

export async function exportWordTask(task: TaskDetail, sources: Source[]) {
  const input: ReportExportInput = {
    report_markdown: task.report_markdown,
    product_name: task.product_name,
    created_at: task.created_at,
    competitors: task.competitors,
    focus: task.focus,
  }
  exportWord(input, sources)
}

export async function exportPdfTask(task: TaskDetail, sources: Source[]) {
  const input: ReportExportInput = {
    report_markdown: task.report_markdown,
    product_name: task.product_name,
    created_at: task.created_at,
    competitors: task.competitors,
    focus: task.focus,
  }
  await exportPdf(input, sources)
}

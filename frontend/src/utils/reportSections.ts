/** 匹配「信息来源 / 参考资料」类章节标题 */
const SOURCES_HEADING = /^(#{1,3})\s+(.*(?:信息来源|参考来源|参考资料|参考文献|来源引用|References?).*)$/im

/**
 * 把报告 markdown 拆为正文与来源章节：
 * LLM 生成的来源章节是大段裸 URL 混排，可读性差，
 * 页面与导出都改用结构化的 sources 数据渲染，这里负责把原始章节剥离。
 */
export function splitSourcesSection(markdown: string): { body: string; sourcesTitle: string | null } {
  const m = SOURCES_HEADING.exec(markdown)
  if (!m) return { body: markdown, sourcesTitle: null }
  const level = m[1].length
  const sectionStart = m.index
  const afterHeading = sectionStart + m[0].length
  // 章节到下一个同级（或更高级）标题为止，通常来源是最后一章
  const nextHeading = new RegExp(`^#{1,${level}}\\s+`, 'm').exec(markdown.slice(afterHeading))
  const sectionEnd = nextHeading ? afterHeading + nextHeading.index : markdown.length
  return {
    body: (markdown.slice(0, sectionStart) + markdown.slice(sectionEnd)).trim(),
    sourcesTitle: m[2].replace(/\[(\d+)\]/g, '').trim(),
  }
}

/** 去除 source 章节后的正文 */
export function stripSourcesSection(markdown: string): string {
  const m = SOURCES_HEADING.exec(markdown)
  if (!m) return markdown
  const level = m[1].length
  const afterHeading = m.index + m[0].length
  const nextHeading = new RegExp(`^#{1,${level}}\\s+`, 'm').exec(markdown.slice(afterHeading))
  const end = nextHeading ? afterHeading + nextHeading.index : markdown.length
  return (markdown.slice(0, m.index) + markdown.slice(end)).trim()
}

/** 提取末尾来源章节内容 */
export function extractSourcesSection(markdown: string): { title: string | null; body: string } {
  const m = SOURCES_HEADING.exec(markdown)
  if (!m) return { title: null, body: '' }
  const level = m[1].length
  const afterHeading = m.index + m[0].length
  const nextHeading = new RegExp(`^#{1,${level}}\\s+`, 'm').exec(markdown.slice(afterHeading))
  const end = nextHeading ? afterHeading + nextHeading.index : markdown.length
  return { title: m[2].replace(/\[(\d+)\]/g, '').trim(), body: markdown.slice(afterHeading, end).trim() }
}

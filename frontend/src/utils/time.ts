/** 后端时间为 UTC，序列化可能不带时区后缀，缺失时补 Z 再解析（HANDOFF 约定） */
export function parseUtc(iso: string): Date {
  return new Date(/Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
}

/** 安全地格式化为本地日期字符串 */
export function fmtDate(iso: string): string {
  return parseUtc(iso).toLocaleDateString('zh-CN')
}

/** 安全地格式化为本地日期时间字符串 */
export function fmtDateTime(iso: string): string {
  return parseUtc(iso).toLocaleString('zh-CN')
}

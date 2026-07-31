/** 后端时间为 UTC，序列化可能不带时区后缀，缺失时补 Z 再解析（HANDOFF 约定） */
export function parseUtc(iso: string) {
  return new Date(/Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
}

import type { SourceTier } from '../api/types'

const TIER_STYLES: Record<SourceTier, { label: string; cls: string }> = {
  official: { label: '官方', cls: 'bg-blue-50 text-blue-800 ring-blue-200' },
  media: { label: '媒体', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  community: { label: '社区', cls: 'bg-green-50 text-green-800 ring-green-200' },
  other: { label: '其他', cls: 'bg-gray-50 text-gray-700 ring-gray-200' },
}

export const TIER_LABELS: Record<SourceTier, string> = {
  official: '官方',
  media: '媒体',
  community: '社区',
  other: '其他',
}

export default function TierBadge({ tier }: { tier: SourceTier }) {
  const t = TIER_STYLES[tier] ?? TIER_STYLES.other
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${t.cls}`}>
      {t.label}
    </span>
  )
}

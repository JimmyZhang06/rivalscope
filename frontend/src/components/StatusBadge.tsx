import type { TaskStatus } from '../api/types'

const STATUS_MAP: Record<TaskStatus, { label: string; cls: string; pulse?: boolean }> = {
  pending: { label: '排队中', cls: 'bg-gray-100 text-gray-600' },
  planning: { label: '规划中', cls: 'bg-blue-100 text-blue-700', pulse: true },
  searching: { label: '检索中', cls: 'bg-blue-100 text-blue-700', pulse: true },
  analyzing: { label: '分析中', cls: 'bg-cyan-100 text-cyan-700', pulse: true },
  reporting: { label: '生成报告中', cls: 'bg-cyan-100 text-cyan-700', pulse: true },
  completed: { label: '已完成', cls: 'bg-green-100 text-green-700' },
  failed: { label: '失败', cls: 'bg-red-100 text-red-700' },
}

export default function StatusBadge({ status }: { status: TaskStatus }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.pending
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.pulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {s.label}
    </span>
  )
}

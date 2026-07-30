import type { Plan } from '../api/types'

const STYLES: Record<Plan, string> = {
  free: 'bg-gray-100 text-gray-600',
  pro: 'bg-blue-100 text-blue-700',
  enterprise: 'bg-amber-100 text-amber-700',
}

const NAMES: Record<Plan, string> = {
  free: '免费版',
  pro: '专业版',
  enterprise: '企业版',
}

export default function PlanBadge({ plan }: { plan: Plan }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[plan]}`}>
      {NAMES[plan]}
    </span>
  )
}

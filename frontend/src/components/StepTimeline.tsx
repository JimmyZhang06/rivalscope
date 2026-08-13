import { BarChart3, CheckCircle2, Compass, Dot, PenLine, Search, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Step } from '../api/types'

const PHASE_STYLE: Record<string, { icon: LucideIcon; ring: string; bg: string; text: string }> = {
  planning: { icon: Compass, ring: 'ring-blue-200', bg: 'bg-blue-50', text: 'text-blue-600' },
  searching: { icon: Search, ring: 'ring-cyan-200', bg: 'bg-cyan-50', text: 'text-cyan-600' },
  analyzing: { icon: BarChart3, ring: 'ring-orange-200', bg: 'bg-orange-50', text: 'text-orange-600' },
  reporting: { icon: PenLine, ring: 'ring-blue-200', bg: 'bg-blue-50', text: 'text-blue-600' },
  done: { icon: CheckCircle2, ring: 'ring-green-200', bg: 'bg-green-50', text: 'text-green-600' },
  error: { icon: XCircle, ring: 'ring-red-200', bg: 'bg-red-50', text: 'text-red-600' },
}

const DEFAULT_STYLE = { icon: Dot, ring: 'ring-gray-200', bg: 'bg-gray-50', text: 'text-gray-400' }

export default function StepTimeline({ steps, running }: { steps: Step[]; running: boolean }) {
  return (
    <ol className="space-y-0">
      {steps.map((step, i) => {
        const s = PHASE_STYLE[step.phase] ?? DEFAULT_STYLE
        const isLatest = running && i === steps.length - 1
        return (
          <li key={step.id} className="relative flex gap-3 pb-5">
            {/* 连接线 */}
            {(i < steps.length - 1 || running) && (
              <span className="absolute left-[13px] top-7 h-full w-px bg-gray-200" />
            )}
            <span
              className={`z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ${s.bg} ${s.ring} ${
                isLatest ? 'animate-pulse' : ''
              }`}
            >
              <s.icon className={`h-3.5 w-3.5 ${s.text}`} />
            </span>
            <div className="min-w-0">
              <p className={`text-sm font-medium ${isLatest ? 'text-blue-700' : 'text-gray-800'}`}>{step.title}</p>
              {step.detail && (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-gray-500">{step.detail}</p>
              )}
              <p className="mt-0.5 text-xs text-gray-400">
                {new Date(step.created_at).toLocaleTimeString('zh-CN')}
              </p>
            </div>
          </li>
        )
      })}
      {running && (
        <li className="relative flex gap-3">
          <span className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 ring-1 ring-blue-200">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
          </span>
          <p className="self-center text-sm text-blue-700/70">Agent 正在执行中…</p>
        </li>
      )}
    </ol>
  )
}

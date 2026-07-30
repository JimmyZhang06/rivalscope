import type { Step } from '../api/types'

const PHASE_STYLE: Record<string, { icon: string; ring: string; bg: string }> = {
  planning: { icon: '🧭', ring: 'ring-blue-200', bg: 'bg-blue-50' },
  searching: { icon: '🔍', ring: 'ring-cyan-200', bg: 'bg-cyan-50' },
  analyzing: { icon: '📊', ring: 'ring-orange-200', bg: 'bg-orange-50' },
  reporting: { icon: '📝', ring: 'ring-blue-200', bg: 'bg-blue-50' },
  done: { icon: '✅', ring: 'ring-green-200', bg: 'bg-green-50' },
  error: { icon: '❌', ring: 'ring-red-200', bg: 'bg-red-50' },
}

const DEFAULT_STYLE = { icon: '•', ring: 'ring-gray-200', bg: 'bg-gray-50' }

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
              <span className="absolute left-[13px] top-7 h-full w-px bg-gradient-to-b from-gray-200 to-gray-100" />
            )}
            <span
              className={`z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ring-1 ${s.bg} ${s.ring} ${
                isLatest ? 'animate-pulse' : ''
              }`}
            >
              {s.icon}
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
          <p className="self-center text-sm text-blue-600/70">Agent 正在执行中…</p>
        </li>
      )}
    </ol>
  )
}

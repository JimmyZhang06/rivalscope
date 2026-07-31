import { BarChart3, Check, Compass, PenLine, Search } from 'lucide-react'
import type { TaskStatus } from '../api/types'

const STAGES = [
  { phase: 'planning', label: '规划方案', icon: Compass },
  { phase: 'searching', label: '联网检索', icon: Search },
  { phase: 'analyzing', label: '对比分析', icon: BarChart3 },
  { phase: 'reporting', label: '生成报告', icon: PenLine },
] as const

/** 运行中任务的四阶段步骤条：已完成→蓝色对勾，进行中→高亮脉冲，未开始→灰色 */
export default function PhaseStepper({ status }: { status: TaskStatus }) {
  // pending → -1（全部未开始）；completed/failed 不会渲染本组件，仅兜底视为全部完成
  const activeIdx =
    status === 'completed' || status === 'failed'
      ? STAGES.length
      : STAGES.findIndex((s) => s.phase === status)
  return (
    <ol className="flex items-start">
      {STAGES.map((stage, i) => {
        const done = i < activeIdx
        const active = i === activeIdx
        return (
          <li key={stage.phase} className={`flex items-start ${i > 0 ? 'flex-1' : ''}`}>
            {/* 连接线：与圆心对齐（圆 h-9 → 中心 18px） */}
            {i > 0 && (
              <span
                className={`mx-1.5 mt-[17px] h-0.5 flex-1 rounded-full transition-colors sm:mx-3 ${
                  done || active ? 'bg-blue-500' : 'bg-gray-200'
                }`}
              />
            )}
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                  done
                    ? 'bg-blue-600 text-white'
                    : active
                      ? 'animate-pulse bg-blue-50 text-blue-600 ring-2 ring-blue-500'
                      : 'bg-gray-100 text-gray-400 ring-1 ring-gray-200'
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : <stage.icon className="h-4 w-4" />}
              </span>
              <span
                className={`whitespace-nowrap text-xs ${
                  active ? 'font-semibold text-blue-700' : done ? 'text-gray-700' : 'text-gray-400'
                }`}
              >
                {stage.label}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

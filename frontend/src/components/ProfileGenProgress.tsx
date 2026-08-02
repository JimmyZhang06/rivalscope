import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react'
import type { GenerateTaskStatus } from '../api/types'

const STAGES = [
  { key: 'stage1', label: '页面摘要化', desc: '提取页面核心摘要与维度关联' },
  { key: 'stage2', label: '维度提取', desc: '按模板维度逐项提取结构化数据' },
  { key: 'stage3', label: '聚合校验', desc: '汇总结果、检测冲突、评估置信度' },
]

/** 从 current_step 文本推断当前处于哪个阶段 */
function inferStageIndex(currentStep: string): number {
  if (!currentStep) return -1
  if (currentStep.includes('阶段 1') || currentStep.includes('页面摘要')) return 0
  if (currentStep.includes('阶段 2') || currentStep.includes('维度')) return 1
  if (currentStep.includes('阶段 3') || currentStep.includes('聚合')) return 2
  return -1
}

export default function ProfileGenProgress({
  task,
  onDone,
}: {
  task: GenerateTaskStatus
  onDone?: (result: any) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const prevStatus = useRef(task.status)

  // 当任务刚完成时，通知父组件刷新列表
  useEffect(() => {
    if (prevStatus.current !== 'done' && task.status === 'done' && onDone) {
      onDone(task.result)
    }
    prevStatus.current = task.status
  }, [task.status, task.result, onDone])

  if (task.status === 'pending') {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
        <span>等待启动...</span>
      </div>
    )
  }

  if (task.status === 'error') {
    return (
      <div className="flex items-center gap-2 text-xs text-red-600">
        <XCircle className="h-3.5 w-3.5" />
        <span>生成失败：{task.error || '未知错误'}</span>
      </div>
    )
  }

  const stageIdx = inferStageIndex(task.current_step)

  return (
    <div className="mt-2 rounded-md border border-blue-100 bg-blue-50/50 p-3">
      {/* 顶部：状态 + 当前步骤 */}
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        <span className="text-xs font-medium text-blue-700">
          {task.current_step || '处理中...'}
        </span>
        <button
          onClick={() => setExpanded((p) => !p)}
          className="ml-auto rounded p-0.5 text-gray-400 hover:text-gray-600"
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* 阶段进度条 */}
      <div className="mt-2 flex items-center gap-1">
        {STAGES.map((stage, i) => {
          const isDone = stageIdx > i || task.status === 'done'
          const isActive = stageIdx === i && task.status === 'running'
          return (
            <div key={stage.key} className="flex flex-1 items-center gap-1">
              <div
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  isDone ? 'bg-blue-400' : isActive ? 'bg-blue-300 animate-pulse' : 'bg-gray-200'
                }`}
              />
              {i < STAGES.length - 1 && <div className="w-1" />}
            </div>
          )
        })}
      </div>

      {/* 阶段标签 */}
      <div className="mt-1.5 flex justify-between text-[10px] text-gray-400">
        {STAGES.map((stage, i) => {
          const isDone = stageIdx > i || task.status === 'done'
          const isActive = stageIdx === i && task.status === 'running'
          return (
            <span
              key={stage.key}
              className={`${isDone ? 'text-blue-500' : isActive ? 'text-blue-600 font-medium' : ''}`}
            >
              {stage.label}
            </span>
          )
        })}
      </div>

      {/* 展开：详细信息 */}
      {expanded && (
        <div className="mt-3 space-y-2 border-t border-blue-100 pt-2">
          {STAGES.map((stage, i) => {
            const isDone = stageIdx > i || task.status === 'done'
            const isActive = stageIdx === i && task.status === 'running'
            return (
              <div key={stage.key} className="flex items-start gap-2 text-xs">
                <div className="mt-0.5">
                  {isDone ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-blue-400" />
                  ) : isActive ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                  ) : (
                    <div className="h-3.5 w-3.5 rounded-full border border-gray-300" />
                  )}
                </div>
                <div>
                  <p className={`font-medium ${isDone || isActive ? 'text-gray-700' : 'text-gray-400'}`}>
                    {stage.label}
                  </p>
                  <p className="text-gray-400">{stage.desc}</p>
                </div>
              </div>
            )
          })}

          {/* 时间 */}
          {task.created_at && (
            <p className="pt-1 text-[10px] text-gray-400">
              创建于 {new Date(task.created_at).toLocaleString('zh-CN')}
              {task.updated_at && task.updated_at !== task.created_at && (
                <> · 更新于 {new Date(task.updated_at).toLocaleString('zh-CN')}</>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

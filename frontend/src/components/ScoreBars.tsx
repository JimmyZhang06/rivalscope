import { BarChart3 } from 'lucide-react'
import type { ReportData } from '../api/types'
import ChartCard from './ChartCard'

const COLORS = ['#1d4ed8', '#0e7490', '#475569', '#b45309', '#15803d', '#0369a1']

export default function ScoreBars({
  data,
  confidenceScores,
}: {
  data: ReportData
  confidenceScores?: Record<string, string>
}) {
  const colorOf = new Map(data.competitors.map((c, i) => [c.name, COLORS[i % COLORS.length]]))

  return (
    <ChartCard icon={<BarChart3 className="h-4 w-4" />} title="分维度评分对比" subtitle="按维度横向对比各产品得分，降序排列">
      <div className="grid gap-4 sm:grid-cols-2">
        {data.dimensions.map((dim) => {
          const rows = data.competitors
            .map((c) => ({ name: c.name, score: c.scores[dim] ?? 0 }))
            .sort((a, b) => b.score - a.score)
          return (
            <div key={dim} className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-700">{dim}</p>
              <div className="mt-2 space-y-1.5">
                {rows.map((r) => {
                  const confidence = confidenceScores?.[dim]
                  const lowConf = confidence === 'low'
                  return (
                    <div key={r.name} className={`flex items-center gap-2 ${lowConf ? 'opacity-50' : ''}`}>
                      <span className="w-20 truncate text-xs text-gray-600" title={r.name}>
                        {r.name}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className={`h-full rounded-full transition-all ${lowConf ? 'border border-dashed border-gray-400' : ''}`}
                          style={{ width: `${r.score * 10}%`, backgroundColor: colorOf.get(r.name) }}
                        />
                      </div>
                      <span className="w-6 text-right text-xs font-medium text-gray-700">
                        {r.score}
                        {lowConf && <span className="ml-0.5 text-[9px] text-gray-400">?</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </ChartCard>
  )
}

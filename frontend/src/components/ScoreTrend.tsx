import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { TrendingUp } from 'lucide-react'
import type { TrackerRun } from '../api/types'
import { parseUtc } from '../utils/time'
import ChartCard from './ChartCard'

const COLORS = ['#1d4ed8', '#0e7490', '#475569', '#b45309', '#15803d', '#0369a1']

/** 评分趋势：各维度平均分随期数变化的折线图 */
export default function ScoreTrend({ runs }: { runs: TrackerRun[] }) {
  // 仅取有报告数据的期次，按时间正序（第 1 期在最左）
  const completed = runs
    .filter((r) => r.status === 'completed' && r.report_data)
    .slice()
    .reverse()

  if (completed.length < 2) return null

  const dimensions = completed[completed.length - 1].report_data!.dimensions
  const chartData = completed.map((run, i) => {
    const row: Record<string, string | number> = {
      period: `第${i + 1}期`,
      date: parseUtc(run.created_at).toLocaleDateString('zh-CN'),
    }
    const rd = run.report_data!
    for (const dim of rd.dimensions) {
      const scores = rd.competitors.map((c) => c.scores[dim] ?? 0)
      if (scores.length > 0) {
        row[dim] = Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1))
      }
    }
    return row
  })

  return (
    <ChartCard icon={<TrendingUp className="h-4 w-4" />} title="评分趋势" subtitle="各维度平均评分随期数的变化（0-10）">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 12, fill: '#6b7280' }} />
            <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: '#9ca3af' }} />
            <Tooltip
              labelFormatter={(label, payload) => {
                const date = payload?.[0]?.payload?.date
                return date ? `${label} · ${date}` : label
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {dimensions.map((dim, i) => (
              <Line
                key={dim}
                type="monotone"
                dataKey={dim}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

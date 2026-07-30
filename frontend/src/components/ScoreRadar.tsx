import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import type { ReportData } from '../api/types'
import ChartCard from './ChartCard'

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#0ea5e9']

export default function ScoreRadar({ data }: { data: ReportData }) {
  const chartData = data.dimensions.map((dim) => {
    const row: Record<string, string | number> = { dimension: dim }
    for (const c of data.competitors) row[c.name] = c.scores[dim] ?? 0
    return row
  })

  return (
    <ChartCard icon="🕸️" title="综合能力雷达" subtitle="各产品在核心维度上的量化评分（0-10）">
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={chartData} outerRadius="70%">
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 12, fill: '#4b5563' }} />
            <PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 10, fill: '#9ca3af' }} />
            {data.competitors.map((c, i) => (
              <Radar
                key={c.name}
                name={c.name}
                dataKey={c.name}
                stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={0.12}
                strokeWidth={2}
              />
            ))}
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

import type { ReportData } from '../api/types'
import ChartCard from './ChartCard'

const QUADRANTS = [
  { key: 'strengths', title: '优势 S', cls: 'border-green-200 bg-green-50', dot: 'bg-green-500', text: 'text-green-900' },
  { key: 'weaknesses', title: '劣势 W', cls: 'border-red-200 bg-red-50', dot: 'bg-red-500', text: 'text-red-900' },
  { key: 'opportunities', title: '机会 O', cls: 'border-blue-200 bg-blue-50', dot: 'bg-blue-500', text: 'text-blue-900' },
  { key: 'threats', title: '威胁 T', cls: 'border-orange-200 bg-orange-50', dot: 'bg-orange-500', text: 'text-orange-900' },
] as const

export default function SwotGrid({ data, productName }: { data: ReportData; productName: string }) {
  return (
    <ChartCard icon="⚖️" title={`SWOT 分析 · ${productName}`} subtitle="主产品的优势、劣势、机会与威胁">
      <div className="grid gap-3 sm:grid-cols-2">
        {QUADRANTS.map((q) => (
          <div key={q.key} className={`rounded-lg border p-3 ${q.cls}`}>
            <p className={`text-xs font-semibold ${q.text}`}>{q.title}</p>
            <ul className="mt-2 space-y-1.5">
              {(data.swot[q.key] ?? []).map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${q.dot}`} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </ChartCard>
  )
}

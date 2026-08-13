import { useEffect, useState } from 'react'
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Network,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { listAssets } from '../../api/client'
import type {
  IntelligenceObject,
  IntelligenceObjectListResponse,
  IntelligenceObjectType,
} from '../../api/types'
import { usePageTitle } from '../../hooks/usePageTitle'
import { fmtDateTime } from '../../utils/time'

const PAGE_SIZE = 20

const TYPE_META: Record<IntelligenceObjectType, {
  label: string
  icon: typeof Building2
  classes: string
}> = {
  competitor: { label: '竞品', icon: Building2, classes: 'bg-blue-50 text-blue-700' },
  profile: { label: '画像', icon: Sparkles, classes: 'bg-violet-50 text-violet-700' },
  research_task: { label: '调研', icon: FileText, classes: 'bg-emerald-50 text-emerald-700' },
  graph_project: { label: '图谱', icon: Network, classes: 'bg-amber-50 text-amber-700' },
}

const EMPTY_COUNTS: IntelligenceObjectListResponse['type_counts'] = {
  competitor: 0,
  profile: 0,
  research_task: 0,
  graph_project: 0,
}

function AssetCard({ asset }: { asset: IntelligenceObject }) {
  const navigate = useNavigate()
  const meta = TYPE_META[asset.type]
  const Icon = meta.icon
  const attributes = Object.values(asset.attributes).filter(Boolean).slice(0, 2)

  return (
    <button
      onClick={() => navigate(asset.detail_path)}
      className="group flex w-full items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${meta.classes}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-gray-900">{asset.title}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.classes}`}>{meta.label}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{asset.status}</span>
        </span>
        <span className="mt-1 block truncate text-sm text-gray-500">
          {asset.summary || attributes.join(' · ') || '暂无摘要'}
        </span>
        <span className="mt-2 block text-xs text-gray-400">更新于 {fmtDateTime(asset.updated_at)}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-blue-500" />
    </button>
  )
}

export default function AssetsPage() {
  usePageTitle('情报资产')
  const [data, setData] = useState<IntelligenceObjectListResponse | null>(null)
  const [selectedType, setSelectedType] = useState<IntelligenceObjectType | null>(null)
  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    listAssets({ page, pageSize: PAGE_SIZE, types: selectedType ? [selectedType] : undefined, query })
      .then((result) => { if (!cancelled) setData(result) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : '加载情报资产失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [page, query, selectedType])

  const counts = data?.type_counts ?? EMPTY_COUNTS
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))

  const chooseType = (type: IntelligenceObjectType | null) => {
    setSelectedType(type)
    setPage(1)
  }

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    setQuery(draftQuery)
    setPage(1)
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">情报资产中心</h1>
        <p className="mt-1 text-sm text-gray-500">统一查找竞品、画像、调研报告与关系图谱</p>
      </div>

      <form onSubmit={submitSearch} className="relative mt-6">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={draftQuery}
          onChange={(event) => setDraftQuery(event.target.value)}
          placeholder="搜索名称、行业、调研重点或画像模板…"
          className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-24 text-sm shadow-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          搜索
        </button>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => chooseType(null)}
          className={`rounded-full px-3 py-1.5 text-sm transition ${selectedType === null ? 'bg-slate-900 text-white' : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
        >
          全部 {Object.values(counts).reduce((sum, count) => sum + count, 0)}
        </button>
        {(Object.keys(TYPE_META) as IntelligenceObjectType[]).map((type) => (
          <button
            key={type}
            onClick={() => chooseType(type)}
            className={`rounded-full px-3 py-1.5 text-sm transition ${selectedType === type ? 'bg-slate-900 text-white' : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
          >
            {TYPE_META[type].label} {counts[type]}
          </button>
        ))}
      </div>

      {error && <p className="mt-5 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-gray-400">
          <RefreshCw className="h-4 w-4 animate-spin" /> 加载中…
        </div>
      ) : data?.items.length ? (
        <div className="mt-5 space-y-3">
          {data.items.map((asset) => <AssetCard key={asset.id} asset={asset} />)}
        </div>
      ) : (
        <div className="mt-8 rounded-xl border border-dashed border-gray-200 py-20 text-center">
          <Search className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-500">没有匹配的情报资产</p>
          <p className="mt-1 text-xs text-gray-400">尝试更换分类或搜索词</p>
        </div>
      )}

      {(data?.total ?? 0) > PAGE_SIZE && (
        <div className="mt-6 flex items-center justify-between text-sm text-gray-500">
          <span>共 {data?.total} 项 · 第 {page}/{totalPages} 页</span>
          <span className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-gray-200 bg-white p-2 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-gray-200 bg-white p-2 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

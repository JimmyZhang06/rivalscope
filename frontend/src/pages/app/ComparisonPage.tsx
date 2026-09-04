import { useEffect, useMemo, useState, useRef } from 'react'
import { RefreshCw, Table2 } from 'lucide-react'
import { compareProfiles, getProfileInsights } from '../../api/client'
import type { ComparisonResponse, InsightsData, ReportData } from '../../api/types'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useProfileStore } from '../../stores/profileStore'
import ScoreRadar from '../../components/ScoreRadar'
import AppSelect from '../../components/AppSelect'

export default function ComparisonPage() {
  usePageTitle('竞品对比')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [result, setResult] = useState<ComparisonResponse | null>(null)
  const [comparing, setComparing] = useState(false)
  const [insightsMap, setInsightsMap] = useState<Record<string, InsightsData>>({})
  const [insightsLoading, setInsightsLoading] = useState(false)

  // 从 store 读取
  const templates = useProfileStore((s) => s.templates)
  const allProfiles = useProfileStore((s) => s.profiles)
  const competitors = useProfileStore((s) => s.competitors)
  const storeReload = useProfileStore((s) => s.reload)
  const storeLoading = useProfileStore((s) => s.loading)

  // 根据选中模板过滤画像
  const profiles = useMemo(() => {
    return allProfiles.filter((p) => p.template_id === selectedTemplate && p.status === 'frozen')
  }, [allProfiles, selectedTemplate])

  // 首次挂载加载数据
  useEffect(() => {
    storeReload()
    // competitors 从 store 取，无需额外加载
  }, [storeReload])

  // 处理 ?profile= 参数（从画像详情页"加入对比"跳转过来时预选）
  const urlProfileRef = useRef<string | null>(null)
  urlProfileRef.current = new URLSearchParams(window.location.search).get('profile')

  useEffect(() => {
    if (storeLoading || allProfiles.length === 0) return
    const pre = urlProfileRef.current
    if (pre && selectedIds.length === 0) {
      const p = allProfiles.find((x) => x.id === pre)
      if (p && p.status === 'frozen') {
        setSelectedTemplate(p.template_id)
        setSelectedIds([p.id])
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeLoading, allProfiles])

  const handleTemplateChange = (tid: string) => {
    setSelectedTemplate(tid)
    setSelectedIds([])
    setResult(null)
  }

  const handleCompare = async () => {
    if (selectedIds.length < 2) return
    setComparing(true)
    setError('')
    try {
      const res = await compareProfiles({ template_id: selectedTemplate, profile_ids: selectedIds })
      setResult(res)

      // 加载各画像的洞察数据，供雷达图使用
      setInsightsLoading(true)
      const pairs = await Promise.all(
        selectedIds.map(async (pid) => {
          try {
            const ins = await getProfileInsights(pid)
            return { pid, insights: ins }
          } catch {
            return { pid, insights: null }
          }
        }),
      )
      const next: Record<string, InsightsData> = {}
      pairs.forEach(({ pid, insights }) => { if (insights) next[pid] = insights })
      setInsightsMap(next)

      setNotice('对比完成')
    } catch (err) {
      setError(err instanceof Error ? err.message : '对比失败')
    } finally {
      setComparing(false)
      setInsightsLoading(false)
    }
  }

  const toggleProfile = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  // profile.id → competitor_id 映射（用于后端矩阵数据查找）
  const competitorIdMap = useMemo(() => {
    const m: Record<string, string> = {}
    profiles.forEach((p) => { m[p.id] = p.competitor_id })
    return m
  }, [profiles])

  // competitor.id → competitor name 映射
  const cNameMap = useMemo(() => {
    const m: Record<string, string> = {}
    competitors.forEach((c) => { m[c.id] = c.name })
    return m
  }, [competitors])

  // profile.id → competitor name 映射（用于页面显示）
  const nameMap = useMemo(() => {
    const m: Record<string, string> = {}
    profiles.forEach((p) => {
      m[p.id] = cNameMap[p.competitor_id] || p.competitor_id.slice(0, 8)
    })
    return m
  }, [profiles, cNameMap])

  // 构建雷达图数据
  const radarData: ReportData | null = useMemo(() => {
    const entries = selectedIds
      .map((pid) => ({ pid, insights: insightsMap[pid] }))
      .filter((entry): entry is { pid: string; insights: InsightsData } => Boolean(entry.insights))
    if (entries.length < 2) return null
    const allDimensions = Array.from(
      new Set(entries.flatMap(({ insights }) => Object.keys(insights.scores || {}))),
    )
    if (allDimensions.length === 0) return null
    return {
      dimensions: allDimensions,
      competitors: entries.map(({ pid, insights }) => ({
        name: nameMap[pid] || pid.slice(0, 8),
        scores: insights.scores || {},
        positioning: insights.positioning || '',
      })),
      swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] },
      verdict: '',
    }
  }, [selectedIds, insightsMap, nameMap])

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">横向对比</h1>
      <p className="mt-1 text-sm text-gray-500">基于已冻结画像生成竞品横向对比矩阵</p>

      {notice && <p className="mt-4 rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</p>}
      {error && <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-gray-500">模板</label>
            <AppSelect
              value={selectedTemplate}
              onValueChange={handleTemplateChange}
              ariaLabel="选择对比模板"
              options={[
                { value: '', label: '选择已冻结的模板' },
                ...templates.map((t) => ({ value: t.id, label: `${t.name} (v${t.version})` })),
              ]}
              className="mt-1 w-full"
            />
          </div>
          <button
            onClick={handleCompare}
            disabled={comparing || selectedIds.length < 2}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {comparing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Table2 className="h-4 w-4" />}
            {comparing ? '生成中…' : `对比（已选 ${selectedIds.length} 项）`}
          </button>
        </div>

        {profiles.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-gray-500">选择要对比的画像（至少 2 项）</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {profiles.map((p) => {
                const checked = selectedIds.includes(p.id)
                const name = nameMap[p.id] || p.id.slice(0, 8)
                return (
                  <button
                    key={p.id}
                    onClick={() => toggleProfile(p.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      checked ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {result && (
        <div className="mt-6 space-y-6">
          {/* 雷达图（有洞察数据时展示） */}
          {radarData && (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-4">
                <h3 className="text-sm font-semibold text-gray-900">综合能力雷达</h3>
                <p className="mt-0.5 text-xs text-gray-400">各竞品维度评分对比（0-10）</p>
              </div>
              <div className="p-4">
                <ScoreRadar data={radarData} />
              </div>
            </div>
          )}

          {/* 对比矩阵 */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="text-sm font-semibold text-gray-900">{result.template_name} — 对比矩阵</h3>
              <p className="mt-0.5 text-xs text-gray-400">{result.dimensions.length} 个维度 · {selectedIds.length} 个竞品</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">维度</th>
                    {selectedIds.map((id) => {
                      return <th key={id} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-700">{nameMap[id] || id.slice(0, 8)}</th>
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.matrix.map((row, i) => {
                    // 检测同行差异（后端用 competitor_id 作为 values 的键）
                    const values = selectedIds.map((id) => {
                      const cid = competitorIdMap[id] || id
                      return row.values[cid] || '—'
                    })
                    const allSame = values.length > 1 && values.every((v) => v === values[0])
                    return (
                      <tr key={i} className={!allSame ? 'bg-amber-50/30' : 'hover:bg-gray-50/60'}>
                        <td className="px-4 py-3 text-xs font-medium text-gray-600">{row.dimension}</td>
                        {selectedIds.map((id) => {
                          const cid = competitorIdMap[id] || id
                          const val = row.values[cid] || '—'
                          const isDiff = !allSame
                          return (
                            <td
                              key={id}
                              className={`px-4 py-3 text-xs ${
                                isDiff ? 'text-gray-700' : 'text-emerald-700'
                              }`}
                            >
                              {val}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {!insightsLoading && radarData === null && selectedIds.length >= 2 && (
              <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-400">
                提示：为各竞品生成洞察后可展示雷达图对比
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Lock, RefreshCw, ExternalLink, GitCompare,
  BarChart3, FileText, Lightbulb, Target, Download, ChevronDown, Link2,
} from 'lucide-react'
import {
  freezeProfileApi, generateProfileApi, getProfile, getProfileFullReport,
  listCompetitors, listProfileTemplates,
} from '../../api/client'
import type { Competitor, CompetitorProfile, ProfileTemplate, Source } from '../../api/types'
import { fmtDateTime } from '../../utils/time'
import { usePageTitle } from '../../hooks/usePageTitle'
import ReportView from '../../components/ReportView'
import ReportToc from '../../components/ReportToc'
import ScoreRadar from '../../components/ScoreRadar'
import ScoreBars from '../../components/ScoreBars'
import SwotGrid from '../../components/SwotGrid'
import StepTimeline from '../../components/StepTimeline'
import SourceCard from '../../components/SourceCard'
import SourceDrawer from '../../components/SourceDrawer'
import { exportMarkdown, exportPdf, exportWord } from '../../utils/exportReport'
import type { ReportExportInput } from '../../utils/exportReport'
import type { SourceTier } from '../../api/types'

type Tab = 'overview' | 'report' | 'insights' | 'dimensions' | 'sources'

const TABS: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
  { key: 'overview', label: '概览', icon: BarChart3 },
  { key: 'report', label: '报告', icon: FileText },
  { key: 'insights', label: '洞察', icon: Lightbulb },
  { key: 'dimensions', label: '维度', icon: Target },
  { key: 'sources', label: `信息来源`, icon: Link2 },
]

const TIER_ORDER: SourceTier[] = ['official', 'media', 'community', 'other']
const TIER_BAR_COLORS: Record<SourceTier, string> = {
  official: 'bg-blue-500',
  media: 'bg-amber-400',
  community: 'bg-green-500',
  other: 'bg-gray-300',
}

const TIER_LABEL_MAP: Record<SourceTier, string> = {
  official: '官方',
  media: '媒体',
  community: '社区',
  other: '其他',
}

export default function ProfileDetailPage() {
  usePageTitle('画像详情')
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [profile, setProfile] = useState<CompetitorProfile | null>(null)
  const [competitor, setCompetitor] = useState<Competitor | null>(null)
  const [template, setTemplate] = useState<ProfileTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [freezing, setFreezing] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  const [tab, setTab] = useState<Tab>('overview')
  const [reportMarkdown, setReportMarkdown] = useState('')
  const [reportQuality, setReportQuality] = useState<{ level: string; source_count: number; text_length: number } | null>(null)
  const [sourceIndex, setSourceIndex] = useState<Array<{ n: number; url: string; title: string; tier: string; confidence: number; snippet: string }>>([])
  const [insights, setInsights] = useState<any>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Sources tab state
  const [tierFilter, setTierFilter] = useState<SourceTier | 'all'>('all')
  const [drawer, setDrawer] = useState<{ source: Source; index: number } | null>(null)

  // Helpers: read pre-generated content from profile's independent columns (written by background task)
  const getCachedReport = (profileObj: any, pd: any) => {
    // 优先从独立列读取
    if (profileObj?.report_markdown) {
      return {
        markdown: profileObj.report_markdown,
        sourceIndex: typeof profileObj.source_index_json === 'string'
          ? JSON.parse(profileObj.source_index_json)
          : (profileObj.source_index_json || []),
        quality: pd?.report_quality || null,
      }
    }
    // 回退：从 profile_data 读取（迁移前的老数据）
    if (pd?.report_markdown) {
      return {
        markdown: pd.report_markdown,
        sourceIndex: (pd.source_index || []).map((s: any) => ({
          n: s.n,
          url: s.url,
          title: s.title || '',
          tier: s.tier || 'other',
          confidence: s.confidence || 0,
          snippet: s.snippet || '',
        })),
        quality: pd.report_quality || null,
      }
    }
    return null
  }

  const getCachedInsights = (profileObj: any, pd: any) => {
    // 优先从独立列读取
    if (profileObj?.insights_json) {
      try {
        return JSON.parse(profileObj.insights_json)
      } catch { return null }
    }
    // 回退：从 profile_data 读取
    const cached = pd?.insights
    if (cached && (cached.scores || cached.verdict || cached.swot)) {
      return cached
    }
    return null
  }

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const p = await getProfile(id)
      if (!p) {
        setError('画像不存在')
        setLoading(false)
        return
      }
      setProfile(p)

      let allCompetitors: Competitor[] = []
      try { allCompetitors = await listCompetitors() } catch { /* 非致命 */ }
      let allTemplates: ProfileTemplate[] = []
      try { allTemplates = await listProfileTemplates() } catch { /* 非致命 */ }

      const c = allCompetitors.find((x) => x.id === p.competitor_id)
      if (c) setCompetitor(c)
      const t = allTemplates.find((x) => x.id === p.template_id)
      if (t) setTemplate(t)

      // Refresh cached report/insights from freshly loaded profile data
      const pd = typeof p.profile_data === 'string' ? JSON.parse(p.profile_data) : p.profile_data
      const freshReport = getCachedReport(p, pd)
      if (freshReport) {
        setReportMarkdown(freshReport.markdown)
        setReportQuality(freshReport.quality)
        setSourceIndex(freshReport.sourceIndex)
      }

      const freshInsights = getCachedInsights(p, pd)
      if (freshInsights) {
        setInsights(freshInsights)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    reload()
  }, [reload])

  // Auto-fetch report + insights when profile is loaded (only if not cached)
  useEffect(() => {
    if (!id || !profile) return

    const rawPd = typeof profile.profile_data === 'string'
      ? JSON.parse(profile.profile_data) : profile.profile_data

    // 检测预生成失败标记
    const needsPostProcessing = rawPd?._needs_post_processing
    const hasCachedReport = !!profile.report_markdown || !!rawPd?.report_markdown
    const hasCachedInsights = !!profile.insights_json || !!(rawPd?.insights?.scores || rawPd?.insights?.verdict || rawPd?.insights?.swot)

    if (!needsPostProcessing && hasCachedReport && hasCachedInsights) return

    // 预生成失败：显示重试提示
    if (needsPostProcessing) {
      setNotice(`报告生成失败（${rawPd?._post_processing_error || '未知原因'}），可点击重试`)
    }

    setReportLoading(true)
    setInsightsLoading(true)
    getProfileFullReport(id)
      .then((data) => {
        if (!hasCachedReport) {
          setReportMarkdown(data.report_markdown || '')
          setReportQuality(data.quality || null)
          setSourceIndex((data.source_index || []).map((s: any) => ({
            n: s.n, url: s.url, title: s.title || '', tier: s.tier || 'other',
            confidence: s.confidence || 0, snippet: s.snippet || '',
          })))
        }
        if (!hasCachedInsights) {
          setInsights(data.insights)
        }
      })
      .catch((err) => setNotice('报告加载失败：' + (err?.message || '未知错误')))
      .finally(() => {
        setReportLoading(false)
        setInsightsLoading(false)
      })
  }, [id, profile])

  // Tab 切换时重置导出状态
  useEffect(() => {
    setExportOpen(false)
  }, [tab])

  const handleFreeze = async () => {
    if (!id || !profile) return
    setFreezing(true)
    setError('')
    try {
      await freezeProfileApi(id)
      setNotice('画像已冻结')
      setProfile({ ...profile, status: 'frozen', frozen_at: new Date().toISOString() })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setFreezing(false)
    }
  }

  const handleRegenerate = async () => {
    if (!profile || !competitor) return
    setRegenerating(true)
    setError('')
    try {
      await generateProfileApi({ competitor_id: profile.competitor_id, template_id: profile.template_id })
      setNotice('画像重新生成中，请稍后刷新查看')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setRegenerating(false)
    }
  }

  const handleCompare = () => {
    if (!profile) return
    navigate(`/app/profiles/compare?profile=${profile.id}`)
  }

  // ---------- 导出 ----------

  const handleExport = async (format: 'md' | 'pdf' | 'word') => {
    if (!profile || !competitor || !reportMarkdown) return
    setExporting(true)
    setExportOpen(false)
    try {
      const sourceRefs = sourceIndex.length > 0
        ? sourceIndex.map((s) => ({
            id: s.n,
            title: s.title,
            url: s.url,
            snippet: s.snippet,
            tier: s.tier,
            domain: '',
            published_at: '',
            confidence: s.confidence,
          }))
        : (() => {
            try {
              const raw = profile.source_refs || []
              return raw.map((r: any) => ({
                id: 0,
                title: r.title || '',
                url: r.url || '',
                snippet: r.snippet || '',
                tier: r.tier || 'other',
                domain: '',
                published_at: '',
                confidence: 0,
              }))
            } catch {
              return []
            }
          })()

      const input: ReportExportInput = {
        report_markdown: reportMarkdown,
        product_name: competitor.name,
        created_at: profile.created_at,
      }

      if (format === 'md') {
        exportMarkdown(input)
      } else if (format === 'pdf') {
        await exportPdf(input, sourceRefs as any[])
      } else if (format === 'word') {
        exportWord(input, sourceRefs as any[])
      }
    } catch {
      setNotice('导出失败')
    } finally {
      setExporting(false)
    }
  }

  // ---------- 渲染辅助 ----------

  const qualityBadge = reportQuality ? (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
      reportQuality.level === 'high' ? 'bg-green-100 text-green-700' :
      reportQuality.level === 'medium' ? 'bg-yellow-100 text-yellow-700' :
      'bg-red-100 text-red-700'
    }`}>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      素材质量：{reportQuality.level === 'high' ? '充足' : reportQuality.level === 'medium' ? '一般' : '不足'}
      <span className="font-normal opacity-70">{reportQuality.source_count} 个来源 · {reportQuality.text_length} 字</span>
    </span>
  ) : null

  const renderProfileData = () => {
    if (!profile) return null
    const data = typeof profile.profile_data === 'string' ? JSON.parse(profile.profile_data) : profile.profile_data
    const dims = data?.dimensions || {}
    if (!Object.keys(dims).length) return <p className="text-sm text-gray-400">暂无维度数据</p>

    // label 映射：优先从 insights.dimension_labels 读取（后端已写入 profile_data）
    // fallback 到 template 状态
    const dimLabelMap: Record<string, string> =
        data?.insights?.dimension_labels
        || template?.dimensions?.reduce((acc, d) => { acc[d.key] = d.label; return acc }, {} as Record<string, string>)
        || {}

    const fieldLabelMap: Record<string, Record<string, string>> =
        template?.dimensions?.reduce((acc, dim) => {
            acc[dim.key] = dim.fields.reduce((fAcc, f) => { fAcc[f.key] = f.label; return fAcc }, {} as Record<string, string>)
            return acc
        }, {} as Record<string, Record<string, string>>)
        || {}

    const extractFieldValue = (v: any): { label: string; value: any; confidence?: string; sourceUrl?: string } => {
        if (v && typeof v === 'object' && !Array.isArray(v) && 'v' in v) {
            // 新格式 {v, c, s}
            return {
                label: '',
                value: v.v,
                confidence: v.c,
                sourceUrl: v.s,
            }
        }
        // 旧格式：纯文本或其他
        return { label: '', value: v }
    }

    const insightScores = data?.insights?.scores || {}
    const getScore = (dimKey: string, dimLabel: string): number | null => {
        const s = insightScores[dimLabel] ?? insightScores[dimKey] ?? null
        return typeof s === 'number' ? s : null
    }

    const confBadge = (conf: string) => {
        const map: Record<string, { text: string; cls: string }> = {
            high:   { text: '高可信度', cls: 'bg-emerald-50 text-emerald-600 ring-emerald-200' },
            medium: { text: '中可信度', cls: 'bg-amber-50 text-amber-600 ring-amber-200' },
            low:    { text: '低可信度', cls: 'bg-gray-50 text-gray-500 ring-gray-200' },
        }
        const info = map[conf] || map.low
        return (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${info.cls}`}>
                {info.text}
            </span>
        )
    }

    const scoreColor = (score: number) => {
        if (score >= 7) return 'text-emerald-600 bg-emerald-50'
        if (score >= 4) return 'text-amber-600 bg-amber-50'
        return 'text-rose-600 bg-rose-50'
    }

    const dimColors = [
        { border: 'border-l-blue-500',   bg: 'bg-blue-50/40',   icon: '📦', tag: 'bg-blue-100 text-blue-700' },
        { border: 'border-l-emerald-500', bg: 'bg-emerald-50/40', icon: '🏢', tag: 'bg-emerald-100 text-emerald-700' },
        { border: 'border-l-violet-500',  bg: 'bg-violet-50/40',  icon: '📍', tag: 'bg-violet-100 text-violet-700' },
        { border: 'border-l-amber-500',   bg: 'bg-amber-50/40',   icon: '⚙',  tag: 'bg-amber-100 text-amber-700' },
        { border: 'border-l-rose-500',    bg: 'bg-rose-50/40',    icon: '⚡', tag: 'bg-rose-100 text-rose-700' },
        { border: 'border-l-teal-500',    bg: 'bg-teal-50/40',    icon: '🔗', tag: 'bg-teal-100 text-teal-700' },
        { border: 'border-l-indigo-500',  bg: 'bg-indigo-50/40',  icon: '📊', tag: 'bg-indigo-100 text-indigo-700' },
    ]

    const renderFieldValue = (v: any, dimKey?: string): React.ReactNode => {
        const entry = extractFieldValue(v)
        const display = entry.value

        if (display === null || display === undefined)
            return <span className="text-gray-400">—</span>

        if (typeof display === 'string') {
            const text = display.replace(/\[\d+\]/g, '').trim()
            if (!text || text === '信息不足')
                return <span className="text-gray-400">—</span>
            return <span className="text-sm text-gray-800">{text}</span>
        }

        if (typeof display === 'number' || typeof display === 'boolean')
            return <span className="text-sm text-gray-800">{String(display)}</span>

        if (Array.isArray(display)) {
            if (display.length === 0) return <span className="text-gray-400">—</span>
            if (typeof display[0] === 'string') {
                return (
                    <div className="flex flex-wrap gap-1.5">
                        {display.map((item, i) => (
                            <span key={i} className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                {String(item).replace(/\[\d+\]/g, '').trim()}
                            </span>
                        ))}
                    </div>
                )
            }
            // 对象数组（嵌套结构）
            return (
                <div className="mt-2 space-y-2">
                    {display.map((item: any, i: number) => {
                        const keys = Object.keys(item).filter(k => item[k] !== null && item[k] !== false && item[k] !== '' && item[k] !== '信息不足')
                        const titleKey = keys.find(k => ['name', 'title', 'product', '类别'].includes(k)) || keys[0]
                        const title = String(item[titleKey] || '').replace(/\[\d+\]/g, '').trim()
                        return (
                            <div key={i} className="rounded-lg border border-gray-100 bg-white p-3">
                                {title && <p className="text-sm font-medium text-gray-800">{title}</p>}
                                <div className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                                    {keys.filter(k => k !== titleKey).map(k => {
                                        const val = item[k]
                                        if (val === null || val === undefined || val === '') return null
                                        const label = (dimKey ? fieldLabelMap[dimKey]?.[k] : undefined)
                                            || { name: '名称', category: '类别', description: '描述', price: '价格',
                                                confidence: '置信度', specs: '规格', features: '功能',
                                                date: '日期', type: '类型' }[k] || k
                                        return (
                                            <div key={k} className="text-xs">
                                                <span className="text-gray-400">{label}</span>
                                                <p className="mt-0.5 text-gray-700">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</p>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )
        }

        if (typeof display === 'object' && display !== null) {
            const entries = Object.entries(display).filter(([, val]) => val !== null && val !== false && val !== '' && val !== '信息不足')
            if (entries.length === 0) return <span className="text-gray-400">信息不足</span>
            return (
                <div className="mt-1 space-y-1">
                    {entries.map(([k, val]) => (
                        <div key={k} className="text-xs">
                            <span className="text-gray-400">{k}：</span>
                            <span className="text-gray-700">{renderFieldValue(val, dimKey)}</span>
                        </div>
                    ))}
                </div>
            )
        }

        return <span className="text-sm text-gray-800">{String(display)}</span>
    }

    return (
        <div className="space-y-4">
            {Object.entries(dims).map(([dimKey, fields], idx) => {
                const dimLabel = dimLabelMap[dimKey] || dimKey
                const style = dimColors[idx % dimColors.length]
                const fieldEntries = typeof fields === 'object' && !Array.isArray(fields)
                    ? Object.entries(fields as Record<string, any>) : []
                const filledCount = fieldEntries.filter(([, v]) => {
                    const entry = extractFieldValue(v)
                    return entry.value && entry.value !== '信息不足' && entry.value !== ''
                }).length
                const score = getScore(dimKey, dimLabel)

                return (
                    <div key={dimKey}
                        className={`rounded-xl border border-gray-100 ${style.bg} ${style.border} overflow-hidden`}>
                        {/* 维度标题栏 */}
                        <div className="flex items-center justify-between px-5 py-3">
                            <div className="flex items-center gap-2.5">
                                <span className="text-base">{style.icon}</span>
                                <h3 className="text-sm font-semibold text-gray-800">{dimLabel}</h3>
                                <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${style.tag}`}>
                                    {dimKey}
                                </span>
                            </div>
                            <div className="flex items-center gap-2.5">
                                {score !== null && (
                                    <span className={`rounded-lg px-2.5 py-1 text-sm font-bold ${scoreColor(score)}`}>
                                        {score}
                                    </span>
                                )}
                                <span className="text-xs text-gray-400">
                                    {filledCount}/{fieldEntries.length} 字段
                                </span>
                            </div>
                        </div>

                        {/* 字段列表 */}
                        <div className="border-t border-gray-100/80 px-5 py-3.5">
                            {fieldEntries.length === 0 ? (
                                <p className="text-xs text-gray-400 italic">信息不足</p>
                            ) : (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {fieldEntries.map(([fieldKey, v]) => {
                                        const entry = extractFieldValue(v)
                                        if (!entry.value || entry.value === '信息不足' || entry.value === '')
                                            return null
                                        const fieldLabel = fieldLabelMap[dimKey]?.[fieldKey] || fieldKey

                                        return (
                                            <div key={fieldKey} className="rounded-lg bg-white/70 p-3 ring-1 ring-gray-100">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-medium text-gray-400">{fieldLabel}</span>
                                                    <div className="flex items-center gap-1.5">
                                                        {entry.confidence && confBadge(entry.confidence)}
                                                    </div>
                                                </div>
                                                <div className="mt-1.5">{renderFieldValue(v, dimKey)}</div>
                                                {entry.sourceUrl && (
                                                    <a href={entry.sourceUrl} target="_blank" rel="noreferrer"
                                                        className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-blue-500">
                                                        <ExternalLink className="h-2.5 w-2.5" /> 来源
                                                    </a>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )
            })}
        </div>
    )
  }

  // ---------- 来源数据处理 ----------

  /** Convert profile.source_refs to Source[] with computed fields */
  const normalizeSources = (): Source[] => {
    if (!profile) return []
    const refs = profile.source_refs || []
    // Also merge source_index if available (has richer data like confidence, age_days, tier)
    const indexMap = new Map<number, any>()
    sourceIndex.forEach((s) => indexMap.set(s.n, s))

    return refs.map((ref, i) => {
      const idx = indexMap.get(i + 1)
      const domain = (() => {
        try { return new URL(ref.url).hostname.replace(/^www\./, '') } catch { return '' }
      })()
      return {
        id: i + 1,
        title: ref.title || ref.url,
        url: ref.url,
        snippet: ref.snippet || idx?.snippet || '',
        score: idx?.confidence ? Math.round(idx.confidence * 100) : 50,
        domain,
        tier: (idx?.tier || 'other') as SourceTier,
        published_at: '',
        dimension: '',
        age_days: -1,
        confidence: idx?.confidence || 0,
        conflict_status: 'none',
        is_duplicate: false,
        access_status: '',
      }
    })
  }

  const profileSources = normalizeSources()

  /** Source stats computed from profile sources */
  const sourceStats = (() => {
    const sources = profileSources
    const tierCount = new Map<SourceTier, number>()
    const dimensions = new Set<string>()
    const freshness = { recent: 0, fresh: 0, normal: 0, old: 0, undated: 0 }
    for (const s of sources) {
      tierCount.set(s.tier, (tierCount.get(s.tier) ?? 0) + 1)
      if (s.dimension) dimensions.add(s.dimension)
      if (s.age_days < 0) freshness.undated += 1
      else if (s.age_days <= 30) freshness.recent += 1
      else if (s.age_days <= 180) freshness.fresh += 1
      else if (s.age_days <= 365) freshness.normal += 1
      else freshness.old += 1
    }
    return {
      tierCount,
      dimensions: [...dimensions],
      freshness,
      timeSpan: '',
    }
  })()

  const filteredProfileSources = useMemo(() => {
    const list = profileSources
      .map((source, i) => ({ source, index: i + 1 }))
      .filter(({ source }) => tierFilter === 'all' || source.tier === tierFilter)
    return list
  }, [profileSources, tierFilter])

  // ---------- Tab 内容 ----------

  const renderSourcesTab = () => {
    const sources = profileSources
    const stats = sourceStats
    return (
      <div>
        {/* 概览统计卡 */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border border-gray-100 bg-gray-50/70 p-3.5">
            <p className="text-xl font-bold text-gray-900">{sources.length}</p>
            <p className="mt-0.5 text-xs text-gray-500">信息来源总数</p>
          </div>
          <div className="rounded-md border border-gray-100 bg-gray-50/70 p-3.5">
            <p className="text-xl font-bold text-blue-700">
              {sources.length
                ? Math.round(
                    (((stats.tierCount.get('official') ?? 0) + (stats.tierCount.get('media') ?? 0)) /
                      sources.length) *
                      100,
                  )
                : 0}
              %
            </p>
            <p className="mt-0.5 text-xs text-gray-500">官方与媒体占比</p>
          </div>
          <div className="rounded-md border border-gray-100 bg-gray-50/70 p-3.5">
            <p className="text-xl font-bold text-gray-900">{stats.dimensions.length || '—'}</p>
            <p className="mt-0.5 text-xs text-gray-500">来源类型</p>
          </div>
          <div className="rounded-md border border-gray-100 bg-gray-50/70 p-3.5">
            <p className="text-sm font-bold text-gray-900">{profile?.generation_source === 'crawl' ? '基于爬取页面' : '基于调研来源'}</p>
            <p className="mt-0.5 text-xs text-gray-500">生成方式</p>
          </div>
        </div>

        {/* 可信度分布条 */}
        {sources.length > 0 && (
          <div className="mb-4 rounded-md border border-gray-100 p-3.5">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full">
              {TIER_ORDER.map((t) => {
                const n = stats.tierCount.get(t) ?? 0
                return n > 0 ? (
                  <div
                    key={t}
                    className={TIER_BAR_COLORS[t]}
                    style={{ width: `${(n / sources.length) * 100}%` }}
                    title={`${TIER_LABEL_MAP[t]} ${n} 条`}
                  />
                ) : null
              })}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
              {TIER_ORDER.map((t) => {
                const n = stats.tierCount.get(t) ?? 0
                return n > 0 ? (
                  <span key={t} className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${TIER_BAR_COLORS[t]}`} />
                    {TIER_LABEL_MAP[t]} {n} 条 · {Math.round((n / sources.length) * 100)}%
                  </span>
                ) : null
              })}
            </div>
          </div>
        )}

        {/* 信息新鲜度分布 */}
        {sources.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-gray-100 bg-gray-50/70 px-3.5 py-2.5 text-xs text-gray-600">
            <span className="font-medium text-gray-700">来源类型</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" />官方 {stats.tierCount.get('official') || 0} 条</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />媒体 {stats.tierCount.get('media') || 0} 条</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green-500" />社区 {stats.tierCount.get('community') || 0} 条</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-gray-300" />其他 {stats.tierCount.get('other') || 0} 条</span>
          </div>
        )}

        {/* 筛选与排序 */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(['all', ...TIER_ORDER] as const).map((t) => {
            const count = t === 'all' ? sources.length : stats.tierCount.get(t) ?? 0
            if (t !== 'all' && count === 0) return null
            return (
              <button
                key={t}
                onClick={() => setTierFilter(t)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  tierFilter === t
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t === 'all' ? '全部' : TIER_LABEL_MAP[t]} {count}
              </button>
            )
          })}
        </div>

        {filteredProfileSources.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">没有符合条件的来源</p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {filteredProfileSources.map(({ source, index }) => (
              <SourceCard
                key={source.id}
                source={source}
                index={index}
                onOpenDetail={(s) => setDrawer({ source: s, index })}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderSources = () => {
    if (!profile || !profile.source_refs?.length) return null
    const sources = profileSources.slice(0, 6)
    const moreCount = profileSources.length - 6
    return (
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">来源引用</h3>
          {profile.source_refs.length > 0 && (
            <span className="text-xs text-gray-400">共 {profile.source_refs.length} 条</span>
          )}
        </div>
        <div className="mt-2 space-y-2">
          {sources.map((source, _i) => {
            const tierInfo = { official: '官方', media: '媒体', community: '社区', other: '其他' }[source.tier] || '其他'
            const tierCls = {
              official: 'bg-blue-50 text-blue-700 ring-blue-200',
              media: 'bg-amber-50 text-amber-700 ring-amber-200',
              community: 'bg-green-50 text-green-700 ring-green-200',
              other: 'bg-gray-50 text-gray-600 ring-gray-200',
            }[source.tier] || 'bg-gray-50 text-gray-600 ring-gray-200'
            const confPct = source.confidence > 0 ? Math.round(source.confidence * 100) : 0
            const confColor = confPct >= 70 ? 'bg-emerald-500' : confPct >= 40 ? 'bg-amber-400' : 'bg-red-400'
            const domain = source.domain || (() => { try { return new URL(source.url).hostname.replace(/^www\./, '') } catch { return '' } })()
            return (
              <div key={source.id} className="flex items-start gap-2.5 rounded-md border border-gray-100 bg-white px-3 py-2.5">
                {domain && (
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16`}
                    alt=""
                    className="mt-0.5 h-4 w-4 shrink-0 rounded-sm"
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <a href={source.url} target="_blank" rel="noreferrer" className="truncate text-xs font-medium text-gray-800 hover:text-blue-600 hover:underline" title={source.title || source.url}>
                      {source.title || source.url}
                    </a>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${tierCls}`}>{tierInfo}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-gray-400">{source.url}</p>
                  {source.snippet && (
                    <p className="mt-1 text-xs text-gray-500 line-clamp-2 leading-relaxed">{source.snippet}</p>
                  )}
                  <div className="mt-1.5 flex items-center gap-3">
                    <span className="text-[10px] text-gray-400">可信度</span>
                    <div className="h-1 w-20 overflow-hidden rounded-full bg-gray-100">
                      <div className={`h-full rounded-full ${confColor}`} style={{ width: `${confPct}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-500">{confPct}%</span>
                  </div>
                </div>
              </div>
            )
          })}
          {moreCount > 0 && (
            <p className="text-center text-xs text-gray-400">还有 {moreCount} 条来源，请前往「信息来源」标签页查看</p>
          )}
        </div>
      </div>
    )
  }

  // ---------- Tab 内容 ----------

  const renderOverviewTab = () => {
    const summaryData = profile?.profile_data?.summary
    const summaryPoints = typeof summaryData === 'object' && summaryData?.key_points
      ? summaryData.key_points
      : typeof summaryData === 'string'
        ? [summaryData]
        : []
    return (
      <div className="space-y-5">
        {profile && summaryPoints.length > 0 && (
          <div className="relative rounded-lg border border-blue-100 bg-blue-50/80 px-5 py-4">
            <h3 className="text-sm font-semibold text-blue-900">画像概要</h3>
            <ul className="mt-2 space-y-1">
              {summaryPoints.map((point: string, i: number) => (
                <li key={i} className="text-sm text-blue-800 leading-relaxed">{point}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900">生成信息</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-gray-400">生成来源</p>
              <p className="mt-0.5 text-sm text-gray-700">{profile?.generation_source === 'crawl' ? '基于爬取页面' : '基于调研来源'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">来源数量</p>
              <p className="mt-0.5 text-sm text-gray-700">{profile?.source_refs?.length || 0} 条</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">创建时间</p>
              <p className="mt-0.5 text-sm text-gray-700">{profile ? fmtDateTime(profile.created_at) : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">更新时间</p>
              <p className="mt-0.5 text-sm text-gray-700">{profile ? fmtDateTime(profile.updated_at) : '—'}</p>
            </div>
          </div>
        </div>

        {competitor && (
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900">竞品信息</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-gray-400">名称</p>
                <p className="mt-0.5 text-sm text-gray-700">{competitor.name}</p>
              </div>
              {competitor.alias && (
                <div>
                  <p className="text-xs text-gray-400">别名</p>
                  <p className="mt-0.5 text-sm text-gray-700">{competitor.alias}</p>
                </div>
              )}
              {competitor.website && (
                <div>
                  <p className="text-xs text-gray-400">官网</p>
                  <a href={competitor.website} target="_blank" rel="noreferrer" className="mt-0.5 flex items-center gap-1 text-sm text-blue-600 hover:underline">
                    {competitor.website} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              {competitor.tech_focus && (
                <div>
                  <p className="text-xs text-gray-400">技术领域</p>
                  <p className="mt-0.5 text-sm text-gray-700">{competitor.tech_focus}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {renderSources()}
      </div>
    )
  }

  const renderReportTab = () => {
    if (reportLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="mr-2 h-5 w-5 animate-spin text-blue-600" />
          <span className="text-sm text-gray-500">正在生成报告…</span>
        </div>
      )
    }
    if (!reportMarkdown) {
      return <p className="text-sm text-gray-400">暂无报告</p>
    }
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        {/* 左侧目录 */}
        <aside className="hidden lg:block">
          <ReportToc markdown={reportMarkdown} />
        </aside>
        {/* 右侧内容 */}
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center gap-2 lg:hidden">
              <ReportToc markdown={reportMarkdown} />
            </div>
          </div>
          <ReportView
            markdown={reportMarkdown}
            sources={sourceIndex.map((s) => ({
              id: s.n,
              url: s.url,
              title: s.title,
              snippet: s.snippet,
              tier: s.tier,
              domain: '',
              published_at: '',
              confidence: s.confidence,
            })) as any}
            onCite={(n) => {
              const src = sourceIndex.find((s) => s.n === n)
              if (src?.url) window.open(src.url, '_blank', 'noopener')
            }}
          />
        </div>
      </div>
    )
  }

  const renderInsightsTab = () => {
    if (insightsLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="mr-2 h-5 w-5 animate-spin text-blue-600" />
          <span className="text-sm text-gray-500">正在分析洞察…</span>
        </div>
      )
    }
    if (!insights) {
      return <p className="text-sm text-gray-400">暂无洞察数据</p>
    }

    const hasScores = insights.scores && Object.keys(insights.scores).length > 0
    const reportData = hasScores
      ? {
          dimensions: Object.keys(insights.scores),
          competitors: [{ name: competitor?.name || '', scores: insights.scores, positioning: insights.positioning || '' }],
          swot: insights.swot || { strengths: [], weaknesses: [], opportunities: [], threats: [] },
          verdict: insights.verdict || '',
          timeline: insights.timeline || [],
        }
      : null

    return (
      <div className="space-y-5">
        {insights.verdict && (
          <div className="rounded-lg border border-gray-800 bg-gray-900 px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-400">总体结论</p>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-100">{insights.verdict}</p>
          </div>
        )}

        {insights.positioning && (
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-5 py-4">
            <h3 className="text-sm font-semibold text-blue-900">市场定位</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-blue-800">{insights.positioning}</p>
          </div>
        )}

        {reportData && (
          <div className="grid gap-5 lg:grid-cols-2">
            <ScoreRadar data={reportData} />
            <ScoreBars data={reportData} />
          </div>
        )}

        {insights.swot && (
          <SwotGrid data={{ ...reportData, swot: insights.swot } as any} productName={competitor?.name || ''} />
        )}

        {insights.timeline && insights.timeline.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">关键事件</h3>
            <div className="mt-4">
              <StepTimeline
                steps={insights.timeline.map((e: any, i: number) => ({
                  id: String(i),
                  seq: i,
                  phase: 'done',
                  title: e.title || '',
                  detail: e.summary || '',
                  created_at: e.date || '',
                }))}
                running={false}
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---------- 加载态 ----------

  if (loading) {
    return <div className="mx-auto max-w-5xl px-6 py-8"><p className="text-center text-sm text-gray-400">加载中…</p></div>
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <p className="text-center text-sm text-red-600">{error || '画像不存在'}</p>
        <button onClick={() => navigate('/app/profiles')} className="mx-auto mt-4 flex items-center gap-1 text-sm text-blue-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> 返回画像列表
        </button>
      </div>
    )
  }

  const sourceLabel = (profile as any).generation_source === 'crawl' ? '基于爬取页面' : '基于调研来源'

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <button onClick={() => navigate('/app/profiles')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> 返回画像列表
      </button>

      <div className="mt-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">{competitor?.name || '未知竞品'}</h1>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${profile.status === 'frozen' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {profile.status === 'frozen' ? '已冻结' : '草稿'}
              </span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{sourceLabel}</span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              模板：{template?.name || '未知模板'}
              {template && ` (v${template.version})`}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              创建时间：{fmtDateTime(profile.created_at)}
              {profile.frozen_at && ` · 冻结时间：${fmtDateTime(profile.frozen_at)}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {qualityBadge}
            {profile.status !== 'frozen' && (
              <button onClick={handleFreeze} disabled={freezing} className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                <Lock className="h-3.5 w-3.5" /> {freezing ? '冻结中…' : '冻结'}
              </button>
            )}
            <div className="relative">
              <button
                onClick={() => setExportOpen(!exportOpen)}
                disabled={exporting}
                className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" /> 导出
                <ChevronDown className="h-3 w-3" />
              </button>
              {exportOpen && (
                <div className="absolute right-0 z-20 mt-1 w-32 rounded-md border border-gray-200 bg-white shadow-lg">
                  {[
                    { key: 'md' as const, label: 'Markdown' },
                    { key: 'pdf' as const, label: 'PDF' },
                    { key: 'word' as const, label: 'Word' },
                  ].map((item) => (
                    <button
                      key={item.key}
                      onClick={() => handleExport(item.key)}
                      className="block w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 first:rounded-t-md last:rounded-b-md"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={handleRegenerate} disabled={regenerating} className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? 'animate-spin' : ''}`} /> 重新生成
            </button>
            <button onClick={handleCompare} className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">
              <GitCompare className="h-3.5 w-3.5" /> 加入对比
            </button>
          </div>
        </div>

        {notice && <p className="mt-4 rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</p>}
        {error && <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

        {/* Tab 导航 */}
        <div className="no-print mt-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                tab === t.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {t.key === 'sources' && profile?.source_refs?.length ? ` (${profile.source_refs.length})` : ''}
            </button>
          ))}
        </div>

        {/* Tab 内容 */}
        <div className="mt-5">
          {tab === 'overview' && renderOverviewTab()}
          {tab === 'report' && renderReportTab()}
          {tab === 'insights' && renderInsightsTab()}
          {tab === 'dimensions' && (
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">维度详情</h2>
                {insights?.scores && (
                  <span className="text-xs text-gray-400">
                    基于 {Object.keys(insights.scores).length} 个维度的洞察分析
                  </span>
                )}
              </div>
              <div className="mt-3">{renderProfileData()}</div>
            </div>
          )}
          {tab === 'sources' && renderSourcesTab()}
        </div>
      </div>

      {/* 页面级来源抽屉 */}
      {id && profile && (
        <SourceDrawer
          taskId={id}
          source={drawer?.source ?? null}
          index={drawer?.index ?? 0}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  )
}

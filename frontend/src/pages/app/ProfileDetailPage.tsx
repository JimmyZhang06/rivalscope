import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Lock, RefreshCw, ExternalLink, GitCompare,
  BarChart3, FileText, Lightbulb, Target, Download, ChevronDown,
} from 'lucide-react'
import {
  freezeProfileApi, generateProfileApi, getProfile,
  getProfileInsights, getProfileReport,
  listCompetitors, listProfileTemplates,
} from '../../api/client'
import type { Competitor, CompetitorProfile, ProfileTemplate } from '../../api/types'
import { fmtDateTime } from '../../utils/time'
import { usePageTitle } from '../../hooks/usePageTitle'
import ReportView from '../../components/ReportView'
import ReportToc from '../../components/ReportToc'
import ScoreRadar from '../../components/ScoreRadar'
import ScoreBars from '../../components/ScoreBars'
import SwotGrid from '../../components/SwotGrid'
import StepTimeline from '../../components/StepTimeline'
import { exportMarkdown, exportPdf, exportWord } from '../../utils/exportReport'
import type { ReportExportInput } from '../../utils/exportReport'

type Tab = 'overview' | 'report' | 'insights' | 'dimensions'

const TABS: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
  { key: 'overview', label: '概览', icon: BarChart3 },
  { key: 'report', label: '报告', icon: FileText },
  { key: 'insights', label: '洞察', icon: Lightbulb },
  { key: 'dimensions', label: '维度', icon: Target },
]

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
  const exportRef = useRef<HTMLDivElement>(null)

  // Helpers: read pre-generated content from profile_data (written by background task)
  const getCachedReport = (pd: any) => {
    if (!pd?.report_markdown) return null
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

  const getCachedInsights = (pd: any) => {
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
      const [p, allCompetitors, allTemplates] = await Promise.all([
        getProfile(id),
        listCompetitors(),
        listProfileTemplates(),
      ])
      setProfile(p)
      const c = allCompetitors.find((x) => x.id === p.competitor_id)
      if (c) setCompetitor(c)
      const t = allTemplates.find((x) => x.id === p.template_id)
      if (t) setTemplate(t)

      // Refresh cached report/insights from freshly loaded profile data
      const pd = typeof p.profile_data === 'string' ? JSON.parse(p.profile_data) : p.profile_data
      const freshReport = getCachedReport(pd)
      if (freshReport) {
        setReportMarkdown(freshReport.markdown)
        setReportQuality(freshReport.quality)
        setSourceIndex(freshReport.sourceIndex)
      }

      const freshInsights = getCachedInsights(pd)
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

  // Lazy-load report and insights from API (only if not cached)
  useEffect(() => {
    if (!id || !profile) return
    if (tab === 'report' && !reportMarkdown && !reportLoading) {
      setReportLoading(true)
      getProfileReport(id)
        .then((data) => {
          setReportMarkdown(data.report_markdown || '')
          setReportQuality(data.quality || null)
          setSourceIndex((data.source_index || []).map((s: any) => ({
            n: s.n,
            url: s.url,
            title: s.title || '',
            tier: s.tier || 'other',
            confidence: s.confidence || 0,
            snippet: s.snippet || '',
          })))
        })
        .catch((err) => setNotice('报告加载失败：' + (err?.message || '未知错误')))
        .finally(() => setReportLoading(false))
    }
    if (tab === 'insights' && !insights && !insightsLoading) {
      setInsightsLoading(true)
      getProfileInsights(id)
        .then((data) => setInsights(data))
        .catch((err) => setNotice('洞察加载失败：' + (err?.message || '未知错误')))
        .finally(() => setInsightsLoading(false))
    }
  }, [id, profile, tab, reportMarkdown, reportLoading, insights, insightsLoading])

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
        await exportPdf(input, sourceRefs)
      } else if (format === 'word') {
        exportWord(input)
      }
    } catch {
      setNotice('导出失败')
    } finally {
      setExporting(false)
    }
  }

  // ---------- 渲染辅助 ----------

  const renderProfileData = () => {
    if (!profile) return null
    const data = typeof profile.profile_data === 'string' ? JSON.parse(profile.profile_data) : profile.profile_data
    const dims = data?.dimensions || {}
    if (!Object.keys(dims).length) return <p className="text-sm text-gray-400">暂无维度数据</p>

    const stripRefs = (s: string) => s.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim()

    const isStructuredArray = (arr: any[]): boolean => {
      if (arr.length === 0) return false
      const first = arr[0]
      if (typeof first !== 'object' || first === null) return false
      const keys = Object.keys(first)
      return keys.length >= 2 && keys.some((k) => typeof first[k] === 'object' && first[k] !== null)
    }

    const renderFieldValue = (v: any): React.ReactNode => {
      if (v === null || v === undefined) return <span className="text-gray-400">—</span>
      if (typeof v === 'string') return <span>{stripRefs(v)}</span>
      if (typeof v === 'number' || typeof v === 'boolean') return <span>{String(v)}</span>

      if (Array.isArray(v)) {
        if (v.length === 0) return <span className="text-gray-400">—</span>
        if (typeof v[0] === 'string') {
          return (
            <div className="flex flex-wrap gap-1.5">
              {v.map((item, i) => (
                <span key={i} className="inline-flex rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{stripRefs(item)}</span>
              ))}
            </div>
          )
        }
        if (isStructuredArray(v)) {
          return (
            <div className="mt-2 space-y-2">
              {v.map((item, i) => {
                const itemKeys = Object.keys(item).filter((k) => item[k] !== null && item[k] !== false && item[k] !== '' && item[k] !== '信息不足')
                const titleKey = itemKeys.find((k) => ['name', 'title', 'product', '类别'].includes(k)) || itemKeys[0]
                const title = String(item[titleKey] || '').replace(/\[\d+\]/g, '').trim()
                return (
                  <div key={i} className="rounded-lg border border-gray-100 bg-white p-3">
                    {title && <p className="text-sm font-medium text-gray-800">{title}</p>}
                    <div className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                      {itemKeys.filter((k) => k !== titleKey).map((k) => {
                        const val = item[k]
                        if (val === null || val === undefined || val === '') return null
                        const label = { name: '名称', category: '类别', description: '描述', price: '价格', confidence: '置信度', specs: '规格', features: '功能', date: '日期', type: '类型' }[k] || k
                        return (
                          <div key={k} className="text-xs">
                            <span className="text-gray-400">{label}</span>
                            <p className="mt-0.5 text-gray-700">{typeof val === 'object' ? JSON.stringify(val) : stripRefs(String(val))}</p>
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
        return (
          <div className="mt-1 space-y-1">
            {v.map((item, i) => (
              <div key={i} className="text-xs text-gray-600">
                {typeof item === 'object' ? Object.entries(item).filter(([, val]) => val).map(([k, val]) => `${k}: ${stripRefs(String(val))}`).join('；') : stripRefs(String(item))}
              </div>
            ))}
          </div>
        )
      }

      if (typeof v === 'object' && v !== null) {
        const entries = Object.entries(v).filter(([, val]) => val !== null && val !== false && val !== '' && val !== '信息不足')
        if (entries.length === 0) return <span className="text-gray-400">信息不足</span>
        return (
          <div className="mt-1 space-y-1">
            {entries.map(([k, val]) => (
              <div key={k} className="text-xs">
                <span className="text-gray-400">{k}：</span>
                <span className="text-gray-700">{renderFieldValue(val)}</span>
              </div>
            ))}
          </div>
        )
      }

      return <span>{String(v)}</span>
    }

    const dimColors = ['border-blue-400', 'border-emerald-400', 'border-violet-400', 'border-amber-400', 'border-rose-400', 'border-teal-400', 'border-indigo-400']

    const summaryPoints = typeof data?.summary === 'object' && data.summary?.key_points
      ? data.summary.key_points
      : typeof data?.summary === 'string'
        ? [data.summary]
        : []
    return (
      <div className="space-y-5">
        {summaryPoints.length > 0 && (
          <div className="relative rounded-lg border border-blue-100 bg-blue-50/80 px-5 py-3.5 text-sm text-blue-800 leading-relaxed">
            <ul className="space-y-1">
              {summaryPoints.map((point: string, i: number) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>
        )}
        {Object.entries(dims).map(([dimKey, fields]: [string, any], idx) => {
          const fieldEntries = typeof fields === 'object' && !Array.isArray(fields) ? Object.entries(fields) : []
          const hasContent = fieldEntries.some(([, v]) => {
            if (typeof v === 'string') return v.trim() !== '' && v !== '信息不足'
            if (Array.isArray(v)) return v.length > 0 && v.some((item: any) => item !== null && item !== '' && item !== '信息不足')
            return false
          })
          const borderColor = dimColors[idx % dimColors.length]

          return (
            <div key={dimKey} className={`rounded-lg border-l-[3px] ${borderColor} border border-gray-100 bg-white`}>
              <div className="border-b border-gray-50 px-4 py-2.5">
                <p className="text-sm font-semibold text-gray-700">{dimKey}</p>
              </div>
              <div className="p-4">
                {!hasContent && (
                  <p className="text-xs text-gray-400 italic">信息不足</p>
                )}
                {fieldEntries.map(([k, v]) => {
                  const rawStr = typeof v === 'string' ? v : ''
                  const isEmpty = rawStr === '信息不足' || rawStr === '' || (Array.isArray(v) && v.length === 0)
                  if (isEmpty) return null
                  return (
                    <div key={k} className={fieldEntries.indexOf([k, v]) > 0 ? 'mt-3' : ''}>
                      <span className="text-xs font-medium text-gray-400">{k}</span>
                      <div className="mt-1">{renderFieldValue(v)}</div>
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

  const renderSources = () => {
    if (!profile || !profile.source_refs?.length) return null
    return (
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-gray-700">来源引用</h3>
        <div className="mt-2 space-y-2">
          {profile.source_refs.map((ref) => (
            <div key={ref.url} className="flex items-start gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-gray-600">{ref.title || ref.url}</p>
                <p className="truncate text-xs text-gray-400">{ref.url}</p>
              </div>
            </div>
          ))}
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
    const qualityBadge = reportQuality ? (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        reportQuality.level === 'high' ? 'bg-green-100 text-green-700' :
        reportQuality.level === 'medium' ? 'bg-yellow-100 text-yellow-700' :
        'bg-red-100 text-red-700'
      }`}>
        素材质量：{reportQuality.level === 'high' ? '充足' : reportQuality.level === 'medium' ? '一般' : '不足'}
        <span className="font-normal opacity-70">{reportQuality.source_count} 个来源 · {reportQuality.text_length} 字</span>
      </span>
    ) : null
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ReportToc markdown={reportMarkdown} />
            {qualityBadge}
          </div>
          <div className="relative">
            <button
              onClick={() => setExportOpen(!exportOpen)}
              disabled={exporting}
              className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
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
          }))}
          onCite={(n) => {
            const src = sourceIndex.find((s) => s.n === n)
            if (src?.url) window.open(src.url, '_blank', 'noopener')
          }}
        />
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
            {profile.status !== 'frozen' && (
              <button onClick={handleFreeze} disabled={freezing} className="flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                <Lock className="h-3.5 w-3.5" /> {freezing ? '冻结中…' : '冻结'}
              </button>
            )}
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
              <h2 className="text-lg font-semibold text-gray-900">维度详情</h2>
              <div className="mt-3">{renderProfileData()}</div>
              {renderSources()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

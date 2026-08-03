import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw, Globe, ChevronRight, FileText, Lock, Eye } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { generateProfileApi, generateProfileFromCrawl, getGenerateStatus } from '../../api/client'
import { fmtDateTime } from '../../utils/time'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useProfileStore } from '../../stores/profileStore'

export default function ProfilesPage() {
  usePageTitle('竞品画像')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [selectedCompetitor, setSelectedCompetitor] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatingFromCrawl, setGeneratingFromCrawl] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [genPollTimer, setGenPollTimer] = useState<number | null>(null)
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)

  const navigate = useNavigate()

  const templates = useProfileStore((s) => s.templates)
  const competitors = useProfileStore((s) => s.competitors)
  const profiles = useProfileStore((s) => s.profiles)
  const storeLoading = useProfileStore((s) => s.loading)
  const reload = useProfileStore((s) => s.reload)

  useEffect(() => { reload() }, [reload])

  const showNotice = (msg: string) => {
    setNotice(msg)
    setTimeout(() => setNotice(''), 3000)
  }

  const handleGenerate = async () => {
    if (!selectedTemplate || !selectedCompetitor) return
    setGenerating(true)
    setError('')
    try {
      const result = await generateProfileApi({ competitor_id: selectedCompetitor, template_id: selectedTemplate })
      const taskId = result.task_id
      showNotice('画像生成中…')
      const tid = window.setInterval(async () => {
        try {
          const status = await getGenerateStatus(taskId)
          if (status.status === 'done') {
            clearInterval(tid)
            setGenPollTimer(null)
            if (status.error) {
              setError(`画像数据生成完成，但报告/洞察预生成失败：${status.error}`)
            } else {
              showNotice(`${getCompetitorName(selectedCompetitor)} 画像已生成（含报告与洞察）`)
            }
            await reload()
          } else if (status.status === 'error') {
            clearInterval(tid)
            setGenPollTimer(null)
            setError(`画像生成失败：${status.error || '未知错误'}`)
          } else if (status.current_step) {
            showNotice(status.current_step)
          }
        } catch (err) {
          console.error(`[ProfilePoll] task ${taskId} poll failed:`, err)
          // 非致命：轮询偶发失败不中断
        }
      }, 2000)
      setGenPollTimer(tid)
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动画像生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateFromCrawl = async () => {
    if (!selectedTemplate || !selectedCompetitor) return
    setGeneratingFromCrawl(true)
    setError('')
    try {
      const result = await generateProfileFromCrawl({ competitor_id: selectedCompetitor, template_id: selectedTemplate })
      const taskId = result.task_id
      showNotice('基于爬取页面的画像生成中…')
      const tid = window.setInterval(async () => {
        try {
          const status = await getGenerateStatus(taskId)
          if (status.status === 'done') {
            clearInterval(tid)
            setGenPollTimer(null)
            if (status.error) {
              setError(`画像数据生成完成，但报告/洞察预生成失败：${status.error}`)
            } else {
              showNotice(`${getCompetitorName(selectedCompetitor)} 画像已生成（含报告与洞察）`)
            }
            await reload()
          } else if (status.status === 'error') {
            clearInterval(tid)
            setGenPollTimer(null)
            setError(`画像生成失败：${status.error || '未知错误'}`)
          } else if (status.current_step) {
            showNotice(status.current_step)
          }
        } catch (err) {
          console.error(`[ProfilePoll] task ${taskId} poll failed:`, err)
          // 非致命：轮询偶发失败不中断
        }
      }, 2000)
      setGenPollTimer(tid)
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动画像生成失败')
    } finally {
      setGeneratingFromCrawl(false)
    }
  }

  useEffect(() => () => { if (genPollTimer) clearInterval(genPollTimer) }, [genPollTimer])

  const getCompetitorName = (cid: string) => {
    const c = competitors.find((x) => x.id === cid)
    return c?.name || cid.slice(0, 8)
  }

  const getTemplateName = (tid: string) => {
    const t = templates.find((x) => x.id === tid)
    return t?.name || tid.slice(0, 8)
  }

  const hasCrawlData = (cid: string) => {
    const c = competitors.find((x) => x.id === cid)
    return c?.crawl_status === 'done'
  }

  const getProfileSummary = (p: any): string => {
    try {
      const data = typeof p.profile_data === 'string' ? JSON.parse(p.profile_data) : p.profile_data
      if (data?.summary) {
        if (Array.isArray(data.summary)) {
          return data.summary[0]?.slice(0, 80) + (data.summary[0]?.length > 80 ? '…' : '') || ''
        }
        const s = String(data.summary)
        return s.slice(0, 80) + (s.length > 80 ? '…' : '')
      }
      const dims = data?.dimensions || {}
      const firstDim = Object.entries(dims)[0]
      if (firstDim) {
        const rawFields = (firstDim as any)[1]
        const entries: [string, any][] = typeof rawFields === 'object' && !Array.isArray(rawFields) ? Object.entries(rawFields as Record<string, any>) : []
        const firstField = entries[0]
        if (firstField) return String(firstField[1]).slice(0, 60)
      }
      return ''
    } catch {
      return ''
    }
  }

  const getDimCount = (p: any): number => {
    try {
      const data = typeof p.profile_data === 'string' ? JSON.parse(p.profile_data) : p.profile_data
      return Object.keys(data?.dimensions || {}).length
    } catch {
      return 0
    }
  }

  const getSourceCount = (p: any): number => {
    return Array.isArray(p.source_refs) ? p.source_refs.length : 0
  }

  const statusConfig = {
    frozen: { label: '已冻结', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: Lock },
    draft: { label: '草稿', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: Eye },
    completed: { label: '已完成', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: FileText },
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">竞品画像</h1>
          <p className="mt-1 text-sm text-gray-500">按模板维度生成竞品结构化画像</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <FileText className="h-4 w-4" />
          <span>{profiles.length} 个画像</span>
        </div>
      </div>

      {notice && <p className="mt-4 rounded-md bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 border border-emerald-100">{notice}</p>}
      {error && <p className="mt-4 rounded-md bg-red-50 px-4 py-2.5 text-sm text-red-600 border border-red-100">{error}</p>}

      {/* Generator Panel */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/50 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
            <Sparkles className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">生成画像</p>
            <p className="text-xs text-gray-400">选择竞品和已冻结的模板，AI 将生成结构化画像</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">竞品</label>
            <select value={selectedCompetitor} onChange={(e) => setSelectedCompetitor(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
              <option value="">选择竞品</option>
              {competitors.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">模板</label>
            <select value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
              <option value="">选择模板</option>
              {templates.filter((t) => t.frozen_at).map((t) => (
                <option key={t.id} value={t.id}>{t.name} (v{t.version})</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            {selectedCompetitor && hasCrawlData(selectedCompetitor) && (
              <button onClick={handleGenerateFromCrawl} disabled={generatingFromCrawl || !selectedTemplate}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
                title="基于已爬取的官网页面生成">
                <Globe className="h-4 w-4" />
                {generatingFromCrawl ? '生成中…' : '基于爬取页面'}
              </button>
            )}
            <button onClick={handleGenerate} disabled={generating || !selectedTemplate || !selectedCompetitor}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50 shadow-sm">
              {generating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? '生成中…' : '生成画像'}
            </button>
          </div>
        </div>
        {templates.some((t) => !t.frozen_at) && (
          <p className="mt-3 flex items-center gap-1 text-xs text-amber-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            存在未冻结的模板，请先在「画像模板」页面冻结后使用
          </p>
        )}
      </div>

      {/* Profiles Grid */}
      {storeLoading ? (
        <div className="mt-12 flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
          <p className="text-sm text-gray-400">加载中…</p>
        </div>
      ) : profiles.length === 0 ? (
        <div className="mt-16 rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gray-50">
            <FileText className="h-7 w-7 text-gray-300" />
          </div>
          <p className="mt-4 text-sm font-medium text-gray-500">还没有画像</p>
          <p className="mt-1 text-xs text-gray-400">选择竞品和模板开始生成</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((p) => {
            const status = statusConfig[p.status as keyof typeof statusConfig] || statusConfig.draft
            const StatusIcon = status.icon
            const summary = getProfileSummary(p)
            const dimCount = getDimCount(p)
            const sourceCount = getSourceCount(p)
            const isHovered = hoveredCard === p.id
            const competitorName = getCompetitorName(p.competitor_id)
            const templateName = getTemplateName(p.template_id)
            const genSource = (p as any).generation_source === 'crawl'

            return (
              <button
                key={p.id}
                onClick={() => navigate(`/app/profiles/${p.id}`)}
                onMouseEnter={() => setHoveredCard(p.id)}
                onMouseLeave={() => setHoveredCard(null)}
                className={`group relative rounded-xl border bg-white p-5 text-left transition-all duration-200 ${
                  isHovered
                    ? 'border-blue-300 shadow-lg shadow-blue-50/50 -translate-y-0.5'
                    : 'border-gray-200 shadow-sm hover:border-gray-300 hover:shadow-md'
                }`}
              >
                {/* Status bar at top */}
                <div className={`absolute left-0 right-0 top-0 h-1 rounded-t-xl ${status.bg.replace('bg-', 'bg-').replace('50', '500')}`} />

                {/* Header */}
                <div className="flex items-start justify-between pt-1">
                  <div className="flex-1 min-w-0">
                    <h3 className="truncate text-base font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">
                      {competitorName}
                    </h3>
                    <p className="mt-0.5 truncate text-xs text-gray-400">{templateName}</p>
                  </div>
                  <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${status.bg} ${status.text} border ${status.border}`}>
                    <StatusIcon className="h-3 w-3" />
                    {status.label}
                  </span>
                </div>

                {/* Summary preview */}
                {summary && (
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-gray-600">
                    {summary}
                  </p>
                )}

                {!summary && (
                  <p className="mt-3 text-sm text-gray-400 italic">暂无摘要</p>
                )}

                {/* Meta footer */}
                <div className="mt-4 flex items-center justify-between border-t border-gray-50 pt-3">
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <span className="font-medium text-gray-500">{dimCount}</span> 维度
                    </span>
                    {sourceCount > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="font-medium text-gray-500">{sourceCount}</span> 来源
                      </span>
                    )}
                    {genSource && (
                      <span className="inline-flex items-center rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">
                        <Globe className="mr-0.5 h-3 w-3" />
                        爬取
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    {fmtDateTime(p.created_at)}
                    <ChevronRight className={`h-3.5 w-3.5 text-gray-300 transition-transform ${isHovered ? 'translate-x-0.5 text-blue-400' : ''}`} />
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

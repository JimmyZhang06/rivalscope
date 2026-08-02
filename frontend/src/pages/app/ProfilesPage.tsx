import { useEffect, useState } from 'react'
import { Sparkles, RefreshCw, Globe } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { generateProfileApi } from '../../api/client'
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

  const navigate = useNavigate()

  // 从 store 读取
  const templates = useProfileStore((s) => s.templates)
  const competitors = useProfileStore((s) => s.competitors)
  const profiles = useProfileStore((s) => s.profiles)
  const storeLoading = useProfileStore((s) => s.loading)
  const reload = useProfileStore((s) => s.reload)

  // 首次挂载加载数据
  useEffect(() => {
    reload()
  }, [reload])

  const handleGenerate = async () => {
    if (!selectedTemplate || !selectedCompetitor) return
    setGenerating(true)
    setError('')
    try {
      await generateProfileApi({ competitor_id: selectedCompetitor, template_id: selectedTemplate })
      setNotice('画像生成成功')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateFromCrawl = async () => {
    if (!selectedTemplate || !selectedCompetitor) return
    setGeneratingFromCrawl(true)
    setError('')
    try {
      await generateProfileApi({ competitor_id: selectedCompetitor, template_id: selectedTemplate })
      setNotice('基于爬取页面的画像生成成功')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setGeneratingFromCrawl(false)
    }
  }

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

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">竞品画像</h1>
      <p className="mt-1 text-sm text-gray-500">按模板维度生成竞品结构化画像</p>

      {notice && <p className="mt-4 rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</p>}
      {error && <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      {/* 生成器 */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Sparkles className="h-4 w-4 text-blue-600" /> 生成画像
        </p>
        <p className="mt-1 text-xs text-gray-400">选择竞品和已冻结的模板，AI 将生成结构化画像</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-gray-500">竞品</label>
            <select value={selectedCompetitor} onChange={(e) => setSelectedCompetitor(e.target.value)} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm">
              <option value="">选择竞品</option>
              {competitors.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-gray-500">模板</label>
            <select value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2.5 text-sm">
              <option value="">选择模板</option>
              {templates.filter((t) => t.frozen_at).map((t) => (
                <option key={t.id} value={t.id}>{t.name} (v{t.version})</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            {selectedCompetitor && hasCrawlData(selectedCompetitor) && (
              <button onClick={handleGenerateFromCrawl} disabled={generatingFromCrawl || !selectedTemplate} className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50" title="基于已爬取的官网页面生成">
                <Globe className="h-4 w-4" />
                {generatingFromCrawl ? '生成中…' : '基于爬取页面'}
              </button>
            )}
            <button onClick={handleGenerate} disabled={generating || !selectedTemplate || !selectedCompetitor} className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50">
              {generating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? '生成中…' : '生成画像'}
            </button>
          </div>
        </div>
        {templates.some((t) => !t.frozen_at) && (
          <p className="mt-2 text-xs text-amber-600">存在未冻结的模板，请先在「画像模板」页面冻结后使用</p>
        )}
      </div>

      {/* 画像列表 */}
      {storeLoading ? (
        <p className="mt-8 text-center text-sm text-gray-400">加载中…</p>
      ) : profiles.length === 0 ? (
        <div className="mt-12 rounded-lg border border-dashed border-gray-300 py-12 text-center">
          <p className="text-sm text-gray-400">还没有画像，选择竞品和模板开始生成</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/app/profiles/${p.id}`)}
              className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm text-left transition hover:border-blue-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{getCompetitorName(p.competitor_id)}</h3>
                    <span className="text-xs text-gray-400">模板：{getTemplateName(p.template_id)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                    <span>状态：{p.status === 'frozen' ? '已冻结' : '草稿'}</span>
                    <span>·</span>
                    <span>{fmtDateTime(p.created_at)}</span>
                  </div>
                  {(p as any).generation_source && (
                    <span className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                      {(p as any).generation_source === 'crawl' ? '基于爬取页面' : '基于调研来源'}
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-400">{p.status === 'frozen' ? '已冻结' : '草稿'}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

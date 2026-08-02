import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock, RefreshCw, ExternalLink, GitCompare } from 'lucide-react'
import { freezeProfileApi, generateProfileApi, listCompetitors, listProfileTemplates } from '../../api/client'
import type { Competitor, CompetitorProfile, ProfileTemplate } from '../../api/types'
import { fmtDateTime } from '../../utils/time'
import { usePageTitle } from '../../hooks/usePageTitle'

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

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const [allProfiles, allCompetitors, allTemplates] = await Promise.all([
        (await import('../../api/client')).listProfiles(),
        listCompetitors(),
        listProfileTemplates(),
      ])
      const p = allProfiles.find((x) => x.id === id)
      if (!p) { setError('画像不存在'); setLoading(false); return }
      setProfile(p)
      const c = allCompetitors.find((x) => x.id === p.competitor_id)
      if (c) setCompetitor(c)
      const t = allTemplates.find((x) => x.id === p.template_id)
      if (t) setTemplate(t)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    reload()
  }, [reload])

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
      setNotice('画像已重新生成')
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

  const renderProfileData = () => {
    if (!profile) return null
    const data = typeof profile.profile_data === 'string' ? JSON.parse(profile.profile_data) : profile.profile_data
    const dims = data?.dimensions || {}
    if (!Object.keys(dims).length) return <p className="text-sm text-gray-400">暂无维度数据</p>

    return (
      <div className="space-y-4">
        {data.summary && (
          <div className="rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-800">
            {data.summary}
          </div>
        )}
        {Object.entries(dims).map(([dimKey, fields]: [string, any]) => (
          <div key={dimKey} className="rounded-lg border border-gray-100 bg-gray-50/60 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{dimKey}</p>
            {typeof fields === 'object' && !Array.isArray(fields) ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {Object.entries(fields).map(([k, v]: [string, any]) => (
                  <div key={k} className="rounded-md bg-white px-3 py-2">
                    <span className="text-xs text-gray-400">{k}</span>
                    <p className="mt-0.5 text-sm text-gray-800">{String(v)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-gray-700">{String(fields)}</p>
            )}
          </div>
        ))}
      </div>
    )
  }

  const renderSources = () => {
    if (!profile || !profile.source_refs?.length) return null
    return (
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-gray-700">来源引用</h3>
        <div className="mt-2 space-y-2">
          {profile.source_refs.map((ref, i) => (
            <div key={i} className="flex items-start gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
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

        <div className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900">画像详情</h2>
          <div className="mt-3">
            {renderProfileData()}
          </div>
        </div>

        {renderSources()}
      </div>
    </div>
  )
}

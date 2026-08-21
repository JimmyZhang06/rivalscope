import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Pencil, Trash2, Building2, Globe, RefreshCw, ChevronDown, ChevronUp, FileText, AlertCircle, Sparkles } from 'lucide-react'
import { createCompetitor, deleteCompetitor, getCrawlStatus, generateProfileFromCrawl, getGenerateStatus, listCrawlPages, startCrawl, updateCompetitor } from '../../api/client'
import type { Competitor, CrawlTask, CompetitorPage, GenerateTaskStatus } from '../../api/types'
import ConfirmDialog from '../../components/ConfirmDialog'
import ProfileGenProgress from '../../components/ProfileGenProgress'
import { fmtDate } from '../../utils/time'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useCompetitorStore } from '../../stores/competitorStore'

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  paused: 'bg-amber-100 text-amber-700',
  archived: 'bg-gray-100 text-gray-500',
}

const STATUS_LABEL: Record<string, string> = {
  active: '启用中',
  paused: '已暂停',
  archived: '已归档',
}

const CRAWL_BADGE: Record<string, string> = {
  idle: 'bg-gray-100 text-gray-500',
  running: 'bg-blue-100 text-blue-600',
  done: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-600',
}

const CRAWL_LABEL: Record<string, string> = {
  idle: '未爬取',
  running: '爬取中',
  done: '已爬取',
  error: '爬取失败',
}

const PAGE_TYPE_LABEL: Record<string, string> = {
  home: '首页',
  pricing: '定价',
  features: '功能',
  products: '产品',
  about: '关于我们',
  customers: '客户',
  case_studies: '案例',
  docs: '文档',
  enterprise: '企业版',
  solutions: '解决方案',
  integrations: '集成',
  technology: '技术',
  company: '公司',
  security: '安全',
  privacy: '隐私',
  contact: '联系我们',
  faq: '常见问题',
  other: '其他',
}

export default function CompetitorsPage() {
  usePageTitle('竞品管理')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Competitor | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [name, setName] = useState('')
  const [alias, setAlias] = useState('')
  const [website, setWebsite] = useState('')
  const [techFocus, setTechFocus] = useState('')
  const [keywords, setKeywords] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteId, setDeleteId] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // 从 store 读取
  const items = useCompetitorStore((s) => s.items)
  const templates = useCompetitorStore((s) => s.templates)
  const storeLoading = useCompetitorStore((s) => s.loading)
  const storeReload = useCompetitorStore((s) => s.reload)

  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const filteredItems = useMemo(() => {
    let list = items
    if (statusFilter !== 'all') list = list.filter((c) => c.status === statusFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.alias && c.alias.toLowerCase().includes(q)) ||
        c.keywords.some((kw) => kw.toLowerCase().includes(q)) ||
        (c.tech_focus && c.tech_focus.toLowerCase().includes(q))
      )
    }
    return list
  }, [items, statusFilter, search])

  // 爬取展开状态：competitor_id -> boolean
  const [expandedCrawl, setExpandedCrawl] = useState<Record<string, boolean>>({})
  // 爬取中状态
  const [crawling, setCrawling] = useState<Record<string, boolean>>({})
  // 各竞品的爬取任务状态
  const [crawlTasks, setCrawlTasks] = useState<Record<string, CrawlTask>>({})
  // 各竞品的页面列表
  const [crawlPages, setCrawlPages] = useState<Record<string, CompetitorPage[]>>({})
  // 轮询定时器
  const pollTimersRef = useRef<Record<string, number>>({})
  // 画像生成任务状态
  const [genTasks, setGenTasks] = useState<Record<string, GenerateTaskStatus | null>>({})
  const genPollTimersRef = useRef<Record<string, number>>({})

  // 首次挂载加载数据
  useEffect(() => {
    storeReload()
  }, [storeReload])

  // 清理轮询
  useEffect(() => {
    return () => {
      Object.values(pollTimersRef.current).forEach((tid) => clearInterval(tid))
      Object.values(genPollTimersRef.current).forEach((tid) => clearInterval(tid))
      pollTimersRef.current = {}
      genPollTimersRef.current = {}
    }
  }, [])

  const resetForm = () => {
    setName('')
    setAlias('')
    setWebsite('')
    setTechFocus('')
    setKeywords('')
    setEditing(null)
    setShowForm(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const payload = {
        name: name.trim(),
        alias: alias.trim(),
        website: website.trim(),
        tech_focus: techFocus.trim(),
        keywords: keywords.split(/[,，、;\s]+/).map((k) => k.trim()).filter(Boolean),
        status: editing ? editing.status : 'active',
      } as any
      if (editing) {
        await updateCompetitor(editing.id, payload)
        setNotice('竞品已更新')
      } else {
        await createCompetitor(payload)
        setNotice('竞品已创建')
      }
      resetForm()
      await storeReload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = (c: Competitor) => {
    setEditing(c)
    setName(c.name)
    setAlias(c.alias)
    setWebsite(c.website)
    setTechFocus(c.tech_focus)
    setKeywords(c.keywords.join(', '))
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    setDeleteId(id)
    setConfirmOpen(true)
  }

  const doDelete = async () => {
    if (!deleteId) return
    setError('')
    setSubmitting(true)
    try {
      await deleteCompetitor(deleteId)
      setNotice('竞品已删除')
      await storeReload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setSubmitting(false)
      setConfirmOpen(false)
      setDeleteId('')
    }
  }

  // ---------- 批量生成画像（后台任务模式） ----------

  const handleQuickGenerate = async (c: Competitor) => {
    if (genPollTimersRef.current[c.id]) return
    if (templates.length === 0) {
      setError('请先在「画像模板」页面创建并冻结一个模板')
      return
    }
    const template = templates[0] // 默认使用第一个冻结模板
    setError('')
    setNotice('')
    try {
      const result = await generateProfileFromCrawl({ competitor_id: c.id, template_id: template.id })
      const taskId = result.task_id
      setGenTasks((prev) => ({ ...prev, [c.id]: {
        task_id: taskId,
        competitor_id: c.id,
        template_id: template.id,
        status: 'running',
        current_step: '',
        error: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } }))
      setNotice(`${c.name} 画像生成中...`)
      // 轮询任务状态
      const tid = window.setInterval(async () => {
        try {
          const status = await getGenerateStatus(taskId)
          setGenTasks((prev) => {
            const prevTask = prev[c.id]
            return { ...prev, [c.id]: { ...prevTask, ...status } }
          })
          if (status.status === 'done' || status.status === 'error') {
            clearInterval(tid)
            delete genPollTimersRef.current[c.id]
            if (status.status === 'done') {
              setNotice(`${c.name} 画像已生成`)
              await storeReload()
            } else {
              setError(`${c.name} 画像生成失败：${status.error || '未知错误'}`)
            }
          }
        } catch (err) {
          console.error(`[ProfilePoll] task ${taskId} poll failed:`, err)
          // 非致命：轮询偶发失败不中断
        }
      }, 2000)
      genPollTimersRef.current[c.id] = tid
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动画像生成失败')
    }
  }

  // ---------- 爬取相关 ----------

  const toggleCrawlExpand = async (c: Competitor) => {
    const next = !expandedCrawl[c.id]
    setExpandedCrawl((prev) => ({ ...prev, [c.id]: next }))
    if (next) {
      // 展开时加载爬取任务状态和页面列表
      await loadCrawlInfo(c.id)
    }
  }

  const loadCrawlInfo = async (competitorId: string) => {
    try {
      const [task, pages] = await Promise.all([
        getCrawlStatus(competitorId).catch((e) => { console.error(`[CrawlInfo] getCrawlStatus failed for ${competitorId}:`, e); return null }),
        listCrawlPages(competitorId).catch((e) => { console.error(`[CrawlInfo] listCrawlPages failed for ${competitorId}:`, e); return [] }),
      ])
      if (task) setCrawlTasks((prev) => ({ ...prev, [competitorId]: task }))
      setCrawlPages((prev) => ({ ...prev, [competitorId]: pages }))
    } catch (err) {
      console.error(`[CrawlInfo] loadCrawlInfo failed for ${competitorId}:`, err)
    }
  }

  const handleStartCrawl = async (c: Competitor) => {
    if (pollTimersRef.current[c.id]) return
    setError('')
    setCrawling((prev) => ({ ...prev, [c.id]: true }))
    try {
      const result = await startCrawl(c.id, 50)
      setNotice(`爬取任务已启动（${result.task_id.slice(0, 8)}...）`)
      // 轮询任务状态
      const tid = window.setInterval(async () => {
        try {
          const task = await getCrawlStatus(c.id)
          setCrawlTasks((prev) => ({ ...prev, [c.id]: task }))
          if (task.status === 'done' || task.status === 'error') {
            clearInterval(tid)
            setCrawling((prev) => {
              const next = { ...prev }
              delete next[c.id]
              return next
            })
            delete pollTimersRef.current[c.id]
            // 加载页面列表
            const pages = await listCrawlPages(c.id)
            setCrawlPages((prev) => ({ ...prev, [c.id]: pages }))
            await storeReload() // 刷新竞品状态
            setNotice(task.status === 'done' ? `爬取完成，共 ${task.crawled_pages} 页` : `爬取失败：${task.error}`)
          }
        } catch (err) {
          console.error(`[CrawlPoll] competitor ${c.id} poll failed:`, err)
          // 非致命：轮询偶发失败不中断
        }
      }, 2000)
      pollTimersRef.current[c.id] = tid
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动爬取失败')
      setCrawling((prev) => {
        const next = { ...prev }
        delete next[c.id]
        return next
      })
    }
  }

  const inputCls = 'w-full rounded-md border border-gray-200 px-4 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500'

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">竞品管理</h1>
          <p className="mt-1 text-sm text-gray-500">管理监测竞品名单、别名、官网与技术主题</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索竞品名称…"
            className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> 新增竞品
          </button>
        </div>
      </div>

      {notice && <p className="mt-4 rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</p>}
      {error && <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      {/* 状态筛选 */}
      <div className="mt-3 flex w-fit gap-1 rounded-lg bg-gray-100 p-1">
        {['all', 'active', 'paused', 'archived'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              statusFilter === s ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {s === 'all' ? '全部' : STATUS_LABEL[s] || s}
          </button>
        ))}
      </div>

      {storeLoading ? (
        <p className="mt-8 text-center text-sm text-gray-400">加载中…</p>
      ) : filteredItems.length === 0 ? (
        <div className="mt-12 rounded-lg border border-dashed border-gray-300 py-12 text-center">
          <Building2 className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm text-gray-400">{search || statusFilter !== 'all' ? '没有匹配的竞品' : '还没有竞品，点击上方按钮添加'}</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((c) => (
            <div key={c.id} className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold text-gray-900">{c.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[c.status] ?? ''}`}>
                        {STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </div>
                    {c.alias && (
                      <p className="mt-1 truncate text-xs text-gray-400">别名：{c.alias}</p>
                    )}
                    {c.website && (
                      <a href={c.website} target="_blank" rel="noopener" className="mt-1 flex items-center gap-1 truncate text-xs text-blue-600 hover:underline">
                        <Globe className="h-3 w-3 flex-shrink-0" />
                        {c.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                      </a>
                    )}
                    {c.tech_focus && (
                      <p className="mt-1.5 text-xs text-gray-500 line-clamp-2">{c.tech_focus}</p>
                    )}
                    {c.keywords.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.keywords.map((kw) => (
                          <span key={kw} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{kw}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="ml-2 flex items-center gap-1">
                    <button onClick={() => handleEdit(c)} className="rounded p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50" title="编辑">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {c.crawl_status === 'done' && templates.length > 0 && (
                      <button
                        onClick={() => handleQuickGenerate(c)}
                        disabled={genTasks[c.id]?.status === 'running'}
                        className="rounded p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40"
                        title="快速生成画像"
                      >
                        <Sparkles className={`h-3.5 w-3.5 ${genTasks[c.id]?.status === 'running' ? 'animate-spin' : ''}`} />
                      </button>
                    )}
                    <button onClick={() => handleDelete(c.id)} className="rounded p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50" title="删除">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* 爬取状态栏 */}
                {c.website && (
                  <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CRAWL_BADGE[c.crawl_status || 'idle']}`}>
                        {CRAWL_LABEL[c.crawl_status || 'idle']}
                      </span>
                      {c.last_crawled_at && (
                        <span className="text-xs text-gray-400">
                          {fmtDate(c.last_crawled_at)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleStartCrawl(c)}
                        disabled={crawling[c.id] || c.crawl_status === 'running'}
                        className="rounded p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40"
                        title="重新爬取"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${crawling[c.id] ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={() => toggleCrawlExpand(c)}
                        className="rounded p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                        title={expandedCrawl[c.id] ? '收起页面列表' : '展开页面列表'}
                      >
                        {expandedCrawl[c.id] ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                )}

                {/* 爬取进度 / 页面列表 */}
                {expandedCrawl[c.id] && c.website && (
                  <div className="mt-2 border-t border-gray-100 pt-3">
                    {crawling[c.id] && (
                      <div className="flex items-center gap-2 text-sm text-blue-600">
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>正在爬取...</span>
                      </div>
                    )}
                    {crawlTasks[c.id] && (
                      <div className="text-xs text-gray-500">
                        {crawlTasks[c.id].status === 'done'
                          ? `完成：${crawlTasks[c.id].crawled_pages} / ${crawlTasks[c.id].total_pages} 页`
                          : crawlTasks[c.id].status === 'error'
                            ? `失败：${crawlTasks[c.id].error}`
                            : `状态：${crawlTasks[c.id].status}`}
                      </div>
                    )}
                    {crawlPages[c.id] && crawlPages[c.id].length > 0 && (
                      <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-gray-100 bg-gray-50">
                        {crawlPages[c.id].map((p) => (
                          <div key={p.id} className="flex items-center gap-2 border-b border-gray-100 px-3 py-1.5 last:border-b-0">
                            <FileText className="h-3 w-3 flex-shrink-0 text-gray-400" />
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noopener"
                              className="flex-1 truncate text-xs text-blue-600 hover:underline"
                              title={p.title || p.url}
                            >
                              {p.title || p.url}
                            </a>
                            <span className="text-xs text-gray-400">{PAGE_TYPE_LABEL[p.page_type] || p.page_type}</span>
                            {p.access_status === 'success'
                              ? <span className="text-xs text-emerald-500">OK</span>
                              : p.access_status === 'failed'
                                ? <span title={p.access_error}><AlertCircle className="h-3 w-3 text-red-400" /></span>
                                : <span className="text-xs text-gray-300">-</span>
                            }
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 画像生成进度 */}
                {genTasks[c.id]?.task_id && (
                  <ProfileGenProgress
                    task={genTasks[c.id]!}
                    onDone={(result) => {
                      setGenTasks((prev) => ({ ...prev, [c.id]: { ...prev[c.id]!, status: 'done', result } }))
                      setNotice(`${c.name} 画像已生成`)
                      storeReload()
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建/编辑弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={resetForm}>
          <div role="dialog" aria-modal="true" aria-labelledby="competitor-dialog-title" className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 id="competitor-dialog-title" className="text-base font-semibold text-gray-900">{editing ? '编辑竞品' : '新增竞品'}</h3>
            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              <div>
                <label htmlFor="competitor-name" className="block text-xs font-medium text-gray-500">竞品名称 *</label>
                <input id="competitor-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} className={inputCls} />
              </div>
              <div>
                <label htmlFor="competitor-alias" className="block text-xs font-medium text-gray-500">别名（逗号分隔）</label>
                <input id="competitor-alias" value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={500} className={inputCls} />
              </div>
              <div>
                <label htmlFor="competitor-website" className="block text-xs font-medium text-gray-500">官网</label>
                <input id="competitor-website" value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={500} placeholder="https://" className={inputCls} />
              </div>
              <div>
                <label htmlFor="competitor-tech-focus" className="block text-xs font-medium text-gray-500">技术主题</label>
                <textarea id="competitor-tech-focus" value={techFocus} onChange={(e) => setTechFocus(e.target.value)} maxLength={2000} rows={2} className={inputCls} />
              </div>
              <div>
                <label htmlFor="competitor-keywords" className="block text-xs font-medium text-gray-500">监测关键词（逗号分隔）</label>
                <input id="competitor-keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="AI芯片, 自动驾驶, 大模型" className={inputCls} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={resetForm} className="rounded-md px-4 py-2 text-sm text-gray-500 hover:bg-gray-50">取消</button>
                <button type="submit" disabled={submitting || !name.trim()} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {submitting ? '保存中…' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 确认删除弹窗 */}
      <ConfirmDialog
        open={confirmOpen}
        title="确认删除"
        message={`删除该竞品后将无法恢复，确定继续？`}
        danger
        loading={submitting}
        onConfirm={doDelete}
        onCancel={() => { setConfirmOpen(false); setDeleteId('') }}
      />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Network } from 'lucide-react'
import { createGraph, deleteGraph } from '../../api/client'
import type { GraphProject, GraphStatus, TimeRange } from '../../api/types'
import ConfirmDialog from '../../components/ConfirmDialog'
import QuotaErrorBanner from '../../components/QuotaErrorBanner'
import { fmtDateTime } from '../../utils/time'
import { usePageTitle } from '../../hooks/usePageTitle'
import { useGraphStore } from '../../stores/graphStore'
import { useAuth } from '../../auth/AuthContext'
import AppSelect from '../../components/AppSelect'

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '', label: '不限' },
  { value: 'week', label: '近 1 周' },
  { value: 'month', label: '近 1 月' },
  { value: 'year', label: '近 1 年' },
]

const STATUS_META: Record<GraphStatus, { label: string; cls: string }> = {
  pending: { label: '排队中', cls: 'bg-gray-100 text-gray-600' },
  building: { label: '构建中', cls: 'bg-blue-100 text-blue-700' },
  completed: { label: '已完成', cls: 'bg-emerald-100 text-emerald-700' },
  failed: { label: '构建失败', cls: 'bg-red-100 text-red-600' },
}

export default function GraphPage() {
  const { user } = useAuth()
  usePageTitle('关系图谱')
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [rootName, setRootName] = useState('')
  const [industry, setIndustry] = useState('')
  const [competitors, setCompetitors] = useState('')
  const [timeRange, setTimeRange] = useState<TimeRange>('year')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteId, setDeleteId] = useState('')

  // 从 store 读取
  const projects = useGraphStore((s) => s.projects)
  const storeLoading = useGraphStore((s) => s.loading)
  const reload = useGraphStore((s) => s.reload)

  // 首次挂载加载数据
  useEffect(() => {
    reload()
  }, [reload])

  // 有构建中/排队中的项目时轮询刷新
  useEffect(() => {
    if (!projects.some((p) => p.status === 'building' || p.status === 'pending')) return
    const timer = setInterval(reload, 4000)
    return () => clearInterval(timer)
  }, [projects, reload])

  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rootName.trim()) return
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      await createGraph({
        root_name: rootName.trim(),
        industry: industry.trim(),
        competitors: competitors.trim(),
        time_range: timeRange,
      })
      setNotice('图谱项目已创建，正在后台构建关系网络…')
      setShowForm(false)
      setRootName('')
      setIndustry('')
      setCompetitors('')
      setTimeRange('year')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (p: GraphProject) => {
    setDeleteId(p.id)
    setConfirmOpen(true)
  }

  const doDelete = async () => {
    if (!deleteId) return
    setSubmitting(true)
    try {
      await deleteGraph(deleteId)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setSubmitting(false)
      setConfirmOpen(false)
      setDeleteId('')
    }
  }

  if (storeLoading) {
    return <div className="mx-auto max-w-5xl px-6 py-8 text-sm text-gray-400">加载中…</div>
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">产业链关系图谱</h1>
          <p className="mt-1 text-sm text-gray-500">
            输入核心企业/产品，Agent 联网抽取上下游、竞争、合作与投资关系，生成可交互的关系网络
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          ＋ 新建图谱
        </button>
      </div>

      {notice && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}
        </div>
      )}
      {error && <QuotaErrorBanner message={error} />}

      {projects.length === 0 ? (
        <div className="mt-16 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 text-gray-400">
            <Network className="h-7 w-7" />
          </span>
          <p className="mt-4 font-medium text-gray-900">还没有关系图谱</p>
          <p className="mt-1 text-sm text-gray-500">新建一个图谱，看看目标企业的产业链上下游与竞合关系</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {projects.map((p) => {
            const meta = STATUS_META[p.status] ?? STATUS_META.pending
            const building = p.status === 'building' || p.status === 'pending'
            const canManage = p.user_id === user?.id || user?.role === 'admin' || user?.org_role === 'owner' || user?.org_role === 'admin'
            const inner = (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-gray-900">{p.root_name}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}>
                    {building && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle" />}
                    {meta.label}
                  </span>
                </div>
                {p.industry && <p className="mt-1.5 text-sm text-gray-500">行业：{p.industry}</p>}
                {p.status === 'failed' && p.error && (
                  <p className="mt-2 line-clamp-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{p.error}</p>
                )}
                <p className="mt-2 text-xs text-gray-400">创建于 {fmtDateTime(p.created_at)}</p>
              </>
            )
            return (
              <div key={p.id} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                {p.status === 'completed' ? (
                  <Link to={`/app/graph/${p.id}`} className="block transition hover:opacity-80">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
                <div className="mt-4 flex items-center gap-2 border-t border-gray-100 pt-3">
                  {p.status === 'completed' && (
                    <Link
                      to={`/app/graph/${p.id}`}
                      className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
                    >
                      查看图谱
                    </Link>
                  )}
                  <span className="flex-1" />
                  {canManage && (
                    <button
                      onClick={() => handleDelete(p)}
                      className="rounded-md border border-red-200 px-4 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="确认删除"
        message="删除该关系图谱后将无法恢复，确定继续？"
        danger
        loading={submitting}
        onConfirm={doDelete}
        onCancel={() => { setConfirmOpen(false); setDeleteId('') }}
      />

      {/* 新建弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
          <div role="dialog" aria-modal="true" aria-labelledby="graph-create-title" className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <h3 id="graph-create-title" className="text-lg font-bold text-gray-900">新建关系图谱</h3>
            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">核心企业 / 产品 *</label>
                <input
                  value={rootName}
                  onChange={(e) => setRootName(e.target.value)}
                  placeholder="如：宁德时代"
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">所属行业（可选）</label>
                <input
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="如：动力电池"
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">已知竞品（可选，逗号分隔）</label>
                <input
                  value={competitors}
                  onChange={(e) => setCompetitors(e.target.value)}
                  placeholder="如：比亚迪, 国轩高科"
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">信息时效</label>
                <AppSelect
                  value={timeRange}
                  onValueChange={(nextValue) => setTimeRange(nextValue as TimeRange)}
                  ariaLabel="选择信息时效"
                  options={TIME_RANGE_OPTIONS}
                  className="mt-1 w-full"
                />
                <p className="mt-1 text-xs text-gray-400">限定检索信息的发布时间范围，构建约需 1~2 分钟</p>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-md border border-gray-200 px-5 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting || !rootName.trim()}
                  className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? '创建中…' : '开始构建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

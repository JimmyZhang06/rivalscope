import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Clock, Crosshair, Gauge, Sparkles, Target, Users } from 'lucide-react'
import { createResearch, getQuota } from '../../api/client'
import type { Quota, TimeRange } from '../../api/types'
import { usePageTitle } from '../../hooks/usePageTitle'

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '', label: '不限' },
  { value: 'week', label: '近 1 周' },
  { value: 'month', label: '近 1 月' },
  { value: 'year', label: '近 1 年' },
]

export default function NewResearchPage() {
  usePageTitle('新建调研')
  const navigate = useNavigate()
  const [quota, setQuota] = useState<Quota | null>(null)
  const [quotaError, setQuotaError] = useState(false)
  const [productName, setProductName] = useState('')
  const [competitors, setCompetitors] = useState('')
  const [focus, setFocus] = useState('')
  const [timeRange, setTimeRange] = useState<TimeRange>('year')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getQuota().then(setQuota).catch(() => setQuotaError(true))
  }, [])

  const exhausted =
    quota !== null &&
    ((quota.limit !== -1 && quota.used >= quota.limit) ||
      (quota.member_limit >= 0 && quota.member_used >= quota.member_limit))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!productName.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const task = await createResearch({
        product_name: productName.trim(),
        competitors: competitors.trim(),
        focus: focus.trim(),
        time_range: timeRange,
      })
      // 携带任务数据跳转，详情页免请求直接进入执行视图
      navigate(`/app/tasks/${task.id}`, { state: { task } })
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建任务失败')
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
          <Sparkles className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">新建竞品调研</h1>
          <p className="mt-1 text-sm text-gray-500">
            输入产品或公司名称，Agent 将自动规划调研方案、联网检索并生成调研报告
          </p>
        </div>
      </div>

      {/* 额度提示 */}
      {quotaError && (
        <div className="mt-4 flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          额度信息加载失败，提交时可能受限，请刷新重试
        </div>
      )}
      {quota && (
        <div
          className={`mt-4 flex items-center justify-between rounded-md border px-4 py-3 text-sm ${
            exhausted ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-100 bg-blue-50 text-blue-700'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Gauge className="h-4 w-4 shrink-0" />
            本月额度：{quota.used} / {quota.limit === -1 ? '不限' : quota.limit} · 每次检索 {quota.max_queries} 组关键词
            {quota.member_limit >= 0 && (
              <span className="ml-1 text-blue-500">
                （成员额度 {quota.member_used} / {quota.member_limit}）
              </span>
            )}
          </span>
          {exhausted && (
            <Link to="/app/pricing" className="font-semibold underline">
              升级套餐 →
            </Link>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-5 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <Target className="h-4 w-4 text-blue-600" /> 调研对象 <span className="text-red-500">*</span>
          </label>
          <input
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="如：Notion、飞书、Figma…"
            className="w-full rounded-md border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            maxLength={200}
            required
            autoFocus
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Users className="h-4 w-4 text-gray-400" /> 指定竞品（可选）
            </label>
            <input
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              placeholder="逗号分隔，如：Obsidian, 语雀"
              className="w-full rounded-md border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              maxLength={2000}
            />
          </div>
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Crosshair className="h-4 w-4 text-gray-400" /> 调研重点（可选）
            </label>
            <input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="如：定价策略、AI 功能对比"
              className="w-full rounded-md border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              maxLength={2000}
            />
          </div>
        </div>
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <Clock className="h-4 w-4 text-gray-400" /> 信息时效
          </label>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as TimeRange)}
            className="w-full rounded-md border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-1/2"
          >
            {TIME_RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">限定检索信息的发布时间范围，越新的信息在报告中权重越高</p>
        </div>
        {error && (
          <p className="flex items-center gap-1.5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || !productName.trim() || exhausted}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {submitting ? '创建中…' : exhausted ? '本月额度已用完' : '开始调研'}
        </button>
      </form>
    </div>
  )
}

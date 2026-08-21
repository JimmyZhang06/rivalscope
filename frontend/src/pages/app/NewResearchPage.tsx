import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, BarChart3, Clock, Compass, Crosshair, Gauge, PenLine, Plus, Search, Sparkles, Target, Users, X } from 'lucide-react'
import { createResearch, getQuota } from '../../api/client'
import type { Quota, TimeRange } from '../../api/types'
import { usePageTitle } from '../../hooks/usePageTitle'

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string; desc: string }[] = [
  { value: '', label: '不限', desc: '覆盖所有时间' },
  { value: 'week', label: '近 1 周', desc: '最新动态' },
  { value: 'month', label: '近 1 月', desc: '近期变化' },
  { value: 'year', label: '近 1 年', desc: '年度对比' },
]

const PIPELINE_STEPS = [
  { icon: Compass, label: '规划关键词', desc: '自动生成检索策略' },
  { icon: Search, label: '联网检索', desc: '多源信息收集' },
  { icon: BarChart3, label: '对比分析', desc: '按维度深度分析' },
  { icon: PenLine, label: '生成报告', desc: 'Markdown + 洞察' },
]

export default function NewResearchPage() {
  usePageTitle('新建调研')
  const navigate = useNavigate()
  const [quota, setQuota] = useState<Quota | null>(null)
  const [quotaError, setQuotaError] = useState(false)
  const [productName, setProductName] = useState('')
  const [focus, setFocus] = useState('')
  const [timeRange, setTimeRange] = useState<TimeRange>('year')
  const [competitorInput, setCompetitorInput] = useState('')
  const [competitors, setCompetitors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const competitorRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    getQuota().then(setQuota).catch(() => setQuotaError(true))
  }, [])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        formRef.current?.requestSubmit()
      }
    }
    document.addEventListener('keydown', handleShortcut)
    return () => document.removeEventListener('keydown', handleShortcut)
  }, [])

  const exhausted =
    quota !== null &&
    ((quota.limit !== -1 && quota.used >= quota.limit) ||
      (quota.member_limit >= 0 && quota.member_used >= quota.member_limit))

  const addCompetitor = () => {
    const parts = competitorInput
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const newOnes = parts.filter((p) => !competitors.includes(p))
    if (newOnes.length > 0) {
      setCompetitors([...competitors, ...newOnes.slice(0, 10 - competitors.length)])
    }
    setCompetitorInput('')
  }

  const removeCompetitor = (name: string) => {
    setCompetitors(competitors.filter((c) => c !== name))
  }

  const handleCompetitorKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) && (e.key === 'Enter' || e.key === ',')) {
      e.preventDefault()
      addCompetitor()
    }
    if (e.key === 'Backspace' && !competitorInput && competitors.length > 0) {
      setCompetitors(competitors.slice(0, -1))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!productName.trim() || exhausted || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const pendingCompetitors = competitorInput
        .split(/[,，、\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
      const submittedCompetitors = [...new Set([...competitors, ...pendingCompetitors])].slice(0, 10)
      const task = await createResearch({
        product_name: productName.trim(),
        competitors: submittedCompetitors.join(', '),
        focus: focus.trim(),
        time_range: timeRange,
      })
      navigate(`/app/tasks/${task.id}`, { state: { task } })
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建任务失败')
      setSubmitting(false)
    }
  }

  const canSubmit = productName.trim() && !exhausted && !submitting

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* 头部 */}
      <div className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-md shadow-blue-200">
          <Sparkles className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">新建竞品调研</h1>
          <p className="mt-1 text-sm text-gray-500">
            输入产品名称，Agent 自动规划、检索并生成结构化报告
          </p>
        </div>
      </div>

      {/* 流程预览 */}
      <div className="mt-6 flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        {PIPELINE_STEPS.map((step, i) => (
          <div key={step.label} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-50 text-gray-400 ring-1 ring-gray-200">
                <step.icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-[11px] text-gray-500">{step.label}</span>
            </div>
            {i < PIPELINE_STEPS.length - 1 && (
              <div className="mx-2 flex-1 border-t border-dashed border-gray-200" />
            )}
          </div>
        ))}
      </div>

      {/* 额度提示 */}
      {quotaError && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          额度信息加载失败，提交时可能受限，请刷新重试
        </div>
      )}
      {quota && (
        <div
          className={`mt-4 flex items-center justify-between rounded-lg border px-4 py-3 text-sm transition-colors ${
            exhausted
              ? 'border-red-200 bg-red-50 text-red-700'
              : quota.limit > 0 && quota.used / quota.limit >= 0.8
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-blue-100 bg-blue-50 text-blue-700'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Gauge className="h-4 w-4 shrink-0" />
            <span className="font-medium">
              额度 {quota.used} / {quota.limit === -1 ? '不限' : quota.limit}
            </span>
            <span className="hidden sm:inline text-gray-500">· 每次 {quota.max_queries} 组关键词</span>
            {quota.member_limit >= 0 && (
              <span className="text-blue-600">（成员 {quota.member_used}/{quota.member_limit}）</span>
            )}
          </span>
          {exhausted && (
            <Link
              to="/app/pricing"
              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
            >
              升级套餐
            </Link>
          )}
        </div>
      )}

      {/* 表单 */}
      <form ref={formRef} onSubmit={handleSubmit} className="mt-6 space-y-5">
        {/* 调研对象 */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <label className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Target className="h-4 w-4 text-blue-600" />
            调研对象 <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="输入产品、公司或品牌名称，如 Notion、飞书、Figma"
              className="w-full rounded-md border border-gray-300 px-4 py-2.5 pr-12 text-sm transition focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              maxLength={200}
              required
              autoFocus
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              {productName.length}/200
            </span>
          </div>
          {productName.trim() && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
              <Sparkles className="h-3 w-3 text-blue-500" />
              将自动识别 {productName.trim()} 的核心竞品并展开全面调研
            </div>
          )}
        </div>

        {/* 竞品 + 调研重点 */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <label className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <Users className="h-4 w-4 text-gray-400" />
              指定竞品
              <span className="font-normal text-gray-400">（可选）</span>
            </label>
            {/* 标签列表 */}
            {competitors.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {competitors.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                  >
                    {c}
                    <button type="button" onClick={() => removeCompetitor(c)} className="hover:text-blue-900">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <input
                ref={competitorRef}
                value={competitorInput}
                onChange={(e) => setCompetitorInput(e.target.value)}
                onKeyDown={handleCompetitorKeyDown}
                onBlur={() => { if (competitorInput.trim()) addCompetitor() }}
                placeholder="输入后按 Enter，如 Obsidian"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm transition focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                maxLength={100}
              />
              {competitorInput && (
                <button
                  type="button"
                  onClick={addCompetitor}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-blue-600"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-1.5 text-xs text-gray-400">回车或逗号添加，最多 10 个</p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <label className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
              <Crosshair className="h-4 w-4 text-gray-400" />
              调研重点
              <span className="font-normal text-gray-400">（可选）</span>
            </label>
            <div className="relative">
              <input
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                placeholder="如：定价策略、AI 功能、市场份额"
                className="w-full rounded-md border border-gray-300 px-4 py-2.5 pr-12 text-sm transition focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                maxLength={500}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                {focus.length}/500
              </span>
            </div>
            <p className="mt-1.5 text-xs text-gray-400">限定分析维度，让报告更有针对性</p>
          </div>
        </div>

        {/* 信息时效 */}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <label className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Clock className="h-4 w-4 text-gray-400" />
            信息时效
          </label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TIME_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTimeRange(opt.value)}
                className={`rounded-lg border px-3 py-2.5 text-center transition ${
                  timeRange === opt.value
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <p className={`text-sm font-medium ${timeRange === opt.value ? 'text-blue-700' : 'text-gray-700'}`}>
                  {opt.label}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 错误 */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* 提交 */}
        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-400">
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-gray-500">Ctrl / ⌘</kbd>
            {' + '}
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-gray-500">Enter</kbd>
            {' '}快速提交
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className={`inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition ${
              canSubmit
                ? 'bg-blue-600 text-white shadow-sm hover:bg-blue-700 hover:shadow active:scale-[0.98]'
                : 'cursor-not-allowed bg-gray-100 text-gray-400'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            {submitting ? '创建中…' : exhausted ? '额度已用完' : '开始调研'}
          </button>
        </div>
      </form>
    </div>
  )
}

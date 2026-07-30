import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createResearch, getQuota } from '../../api/client'
import type { Quota } from '../../api/types'

export default function NewResearchPage() {
  const navigate = useNavigate()
  const [quota, setQuota] = useState<Quota | null>(null)
  const [productName, setProductName] = useState('')
  const [competitors, setCompetitors] = useState('')
  const [focus, setFocus] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getQuota().then(setQuota).catch(() => {})
  }, [])

  const exhausted = quota !== null && quota.limit !== -1 && quota.used >= quota.limit

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
      <h1 className="text-2xl font-bold text-gray-900">新建竞品调研</h1>
      <p className="mt-1 text-sm text-gray-500">
        输入产品或公司名称，Agent 将自动规划调研方案、联网检索并生成调研报告
      </p>

      {/* 额度提示 */}
      {quota && (
        <div
          className={`mt-4 flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${
            exhausted ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-100 bg-blue-50 text-blue-700'
          }`}
        >
          <span>
            本月额度：{quota.used} / {quota.limit === -1 ? '不限' : quota.limit} · 每次检索 {quota.max_queries} 组关键词
          </span>
          {exhausted && (
            <Link to="/app/pricing" className="font-semibold underline">
              升级套餐 →
            </Link>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            调研对象 <span className="text-red-500">*</span>
          </label>
          <input
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="如：Notion、飞书、Figma…"
            className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            maxLength={200}
            required
            autoFocus
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">指定竞品（可选）</label>
            <input
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              placeholder="逗号分隔，如：Obsidian, 语雀"
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              maxLength={2000}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">调研重点（可选）</label>
            <input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="如：定价策略、AI 功能对比"
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              maxLength={2000}
            />
          </div>
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !productName.trim() || exhausted}
          className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? '创建中…' : exhausted ? '本月额度已用完' : '🚀 开始调研'}
        </button>
      </form>
    </div>
  )
}

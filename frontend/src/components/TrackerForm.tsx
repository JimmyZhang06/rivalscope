import { useState } from 'react'
import { Bot, Mail } from 'lucide-react'
import type { Frequency, TimeRange, Tracker, TrackerCreate, WebhookType } from '../api/types'

const FREQ_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'daily', label: '每日' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
]

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '', label: '不限' },
  { value: 'week', label: '近 1 周' },
  { value: 'month', label: '近 1 月' },
  { value: 'year', label: '近 1 年' },
]

const WEBHOOK_OPTIONS: { value: WebhookType; label: string }[] = [
  { value: 'wecom', label: '企业微信' },
  { value: 'dingtalk', label: '钉钉' },
  { value: 'feishu', label: '飞书' },
  { value: 'generic', label: '通用 JSON' },
]

const inputCls =
  'w-full rounded-md border border-gray-200 px-4 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500'

/** 追踪项新建 / 编辑表单（弹窗内使用）；initial 可传部分字段用于外部预填（如图谱实体纳入追踪） */
export default function TrackerForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<Tracker>
  submitting: boolean
  onSubmit: (payload: TrackerCreate) => void
  onCancel: () => void
}) {
  const [productName, setProductName] = useState(initial?.product_name ?? '')
  const [competitors, setCompetitors] = useState(initial?.competitors ?? '')
  const [focus, setFocus] = useState(initial?.focus ?? '')
  const [timeRange, setTimeRange] = useState<TimeRange>(initial?.time_range ?? 'year')
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'daily')
  const [runHour, setRunHour] = useState(initial?.run_hour ?? 9)
  const [pushEmail, setPushEmail] = useState(initial?.push_email ?? true)
  const [pushWebhook, setPushWebhook] = useState(initial?.push_webhook ?? false)
  const [webhookType, setWebhookType] = useState<WebhookType>(initial?.webhook_type ?? 'wecom')
  const [webhookUrl, setWebhookUrl] = useState(initial?.webhook_url ?? '')

  const valid = productName.trim().length > 0 && (!pushWebhook || webhookUrl.trim().startsWith('http'))

  const handleSubmit = () => {
    onSubmit({
      product_name: productName.trim(),
      competitors: competitors.trim(),
      focus: focus.trim(),
      time_range: timeRange,
      frequency,
      run_hour: runHour,
      push_email: pushEmail,
      push_webhook: pushWebhook,
      webhook_type: webhookType,
      webhook_url: pushWebhook ? webhookUrl.trim() : '',
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">目标产品 *</label>
        <input
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          placeholder="如：飞书"
          maxLength={100}
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">竞品（可选，逗号分隔）</label>
        <input
          value={competitors}
          onChange={(e) => setCompetitors(e.target.value)}
          placeholder="如：钉钉, 企业微信；留空由 Agent 自动发现"
          maxLength={300}
          className={inputCls}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">调研重点（可选）</label>
        <input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="如：定价策略与 AI 功能"
          maxLength={300}
          className={inputCls}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">运行频率</label>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} className={inputCls}>
            {FREQ_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">运行时点</label>
          <select value={runHour} onChange={(e) => setRunHour(Number(e.target.value))} className={inputCls}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-gray-700">信息时效</label>
        <select value={timeRange} onChange={(e) => setTimeRange(e.target.value as TimeRange)} className={inputCls}>
          {TIME_RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-400">限定每期检索信息的发布时间范围，越新的信息权重越高</p>
      </div>

      {/* 推送渠道 */}
      <div className="rounded-md bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700">报告推送渠道</p>
        <p className="mt-0.5 text-xs text-gray-400">每期运行完成后自动推送（站内通知始终发送）</p>
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={pushEmail}
            onChange={(e) => setPushEmail(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <Mail className="h-4 w-4 text-gray-400" /> 邮件推送（发送至企业成员邮箱）
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={pushWebhook}
            onChange={(e) => setPushWebhook(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <Bot className="h-4 w-4 text-gray-400" /> Webhook 群机器人
        </label>
        {pushWebhook && (
          <div className="mt-3 space-y-3">
            <select
              value={webhookType}
              onChange={(e) => setWebhookType(e.target.value as WebhookType)}
              className={inputCls}
            >
              {WEBHOOK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="Webhook 地址，https:// 开头"
              className={inputCls}
            />
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-1">
        <button
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 rounded-md border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
        >
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || !valid}
          className="flex-1 rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? '保存中…' : initial?.id ? '保存修改' : '创建追踪'}
        </button>
      </div>
    </div>
  )
}

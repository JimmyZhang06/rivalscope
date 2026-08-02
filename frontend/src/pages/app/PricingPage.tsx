import { useEffect, useState } from 'react'
import { Check, CheckCircle2, X } from 'lucide-react'
import { listPlans, upgradePlan } from '../../api/client'
import type { Plan, PlanInfo } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { fmtDate } from '../../utils/time'
import { usePageTitle } from '../../hooks/usePageTitle'

export default function PricingPage() {
  usePageTitle('套餐升级')
  const { user, refreshUser } = useAuth()
  const [plans, setPlans] = useState<PlanInfo[]>([])
  const [paying, setPaying] = useState<PlanInfo | null>(null) // 模拟支付弹窗
  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    listPlans().then(setPlans).catch(() => {})
  }, [])

  const handlePay = async () => {
    if (!paying) return
    setProcessing(true)
    setError('')
    try {
      await upgradePlan(paying.key as Plan)
      await refreshUser()
      setSuccess(`已成功开通${paying.name}，套餐立即生效`)
      setPaying(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '支付失败')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">套餐升级</h1>
      <p className="mt-1 text-sm text-gray-500">
        当前套餐：<span className="font-medium text-gray-900">{plans.find((p) => p.key === user?.plan)?.name ?? user?.plan}</span>
        {user?.plan_expires_at && (
          <> · 有效期至 {fmtDate(user.plan_expires_at)}</>
        )}
      </p>

      {success && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {success}
        </div>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = user?.plan === p.key
          const highlight = p.key === 'pro'
          return (
            <div
              key={p.key}
              className={`relative flex flex-col overflow-hidden rounded-lg border bg-white p-7 shadow-sm ${
                highlight ? 'border-blue-600 shadow-md ring-1 ring-blue-600' : 'border-gray-200'
              }`}
            >
              {highlight && (
                <span className="absolute right-4 top-4 rounded-full bg-blue-50 px-3 py-0.5 text-xs font-bold text-blue-700">
                  最受欢迎
                </span>
              )}
              <h3 className="text-lg font-semibold text-gray-900">{p.name}</h3>
              <p className="mt-1 text-sm text-gray-500">{p.description}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold tabular-nums tracking-tight text-gray-900">¥{p.price}</span>
                <span className="text-gray-400">/月</span>
              </div>
              <ul className="mt-6 flex-1 space-y-3 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-blue-700" />
                  {p.monthly_tasks === -1 ? '不限调研次数' : `每月 ${p.monthly_tasks} 次调研`}
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-blue-700" />
                  {p.max_queries} 组检索关键词/次
                </li>
                <li className="flex items-center gap-2">
                  {p.priority ? (
                    <Check className="h-4 w-4 shrink-0 text-blue-700" />
                  ) : (
                    <X className="h-4 w-4 shrink-0 text-gray-300" />
                  )}
                  <span className={p.priority ? '' : 'text-gray-400 line-through'}>优先执行队列</span>
                </li>
              </ul>
              {isCurrent ? (
                <button
                  disabled
                  className="mt-8 rounded-md border border-gray-200 bg-gray-50 py-2.5 text-sm font-semibold text-gray-400"
                >
                  当前套餐
                </button>
              ) : p.price === 0 ? (
                <button
                  disabled
                  className="mt-8 rounded-md border border-gray-200 bg-gray-50 py-2.5 text-sm font-semibold text-gray-400"
                >
                  基础套餐
                </button>
              ) : (
                <button
                  onClick={() => {
                    setSuccess('')
                    setError('')
                    setPaying(p)
                  }}
                  className={`mt-8 rounded-md py-2.5 text-sm font-semibold transition ${
                    highlight
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'border border-blue-600 text-blue-700 hover:bg-blue-50'
                  }`}
                >
                  {user?.plan === 'free' ? '立即升级' : '切换 / 续费'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <p className="mt-6 text-center text-xs text-gray-400">
        本项目为演示环境，支付为模拟流程，不会产生真实扣款 · 同套餐续费自动顺延 30 天
      </p>

      {/* 模拟支付弹窗 */}
      {paying && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">确认支付</h3>
            <div className="mt-4 rounded-md bg-gray-50 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">套餐</span>
                <span className="font-medium text-gray-900">{paying.name} · 30 天</span>
              </div>
              <div className="mt-2 flex justify-between">
                <span className="text-gray-500">支付方式</span>
                <span className="font-medium text-gray-900">模拟支付</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-gray-200 pt-2">
                <span className="text-gray-500">应付金额</span>
                <span className="text-lg font-bold tabular-nums text-blue-700">¥{paying.price}</span>
              </div>
            </div>
            {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setPaying(null)}
                disabled={processing}
                className="flex-1 rounded-md border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handlePay}
                disabled={processing}
                className="flex-1 rounded-md bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {processing ? '支付中…' : '确认支付'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

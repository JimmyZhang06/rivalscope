import { useEffect, useState } from 'react'
import { listPlans, upgradePlan } from '../../api/client'
import type { Plan, PlanInfo } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'

export default function PricingPage() {
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
      <h1 className="text-2xl font-bold text-gray-900">套餐升级</h1>
      <p className="mt-1 text-sm text-gray-500">
        当前套餐：<span className="font-medium text-gray-900">{plans.find((p) => p.key === user?.plan)?.name ?? user?.plan}</span>
        {user?.plan_expires_at && (
          <> · 有效期至 {new Date(user.plan_expires_at).toLocaleDateString('zh-CN')}</>
        )}
      </p>

      {success && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          ✅ {success}
        </div>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = user?.plan === p.key
          const highlight = p.key === 'pro'
          return (
            <div
              key={p.key}
              className={`relative flex flex-col rounded-2xl border bg-white p-7 shadow-sm ${
                highlight ? 'border-blue-600 ring-1 ring-blue-600' : 'border-gray-200'
              }`}
            >
              {highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-0.5 text-xs font-bold text-white">
                  最受欢迎
                </span>
              )}
              <h3 className="text-lg font-semibold text-gray-900">{p.name}</h3>
              <p className="mt-1 text-sm text-gray-500">{p.description}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-gray-900">¥{p.price}</span>
                <span className="text-gray-400">/月</span>
              </div>
              <ul className="mt-6 flex-1 space-y-3 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <span className="text-blue-600">✓</span>
                  {p.monthly_tasks === -1 ? '不限调研次数' : `每月 ${p.monthly_tasks} 次调研`}
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-blue-600">✓</span>
                  {p.max_queries} 组检索关键词/次
                </li>
                <li className="flex items-center gap-2">
                  <span className={p.priority ? 'text-blue-600' : 'text-gray-300'}>{p.priority ? '✓' : '✕'}</span>
                  <span className={p.priority ? '' : 'text-gray-400 line-through'}>优先执行队列</span>
                </li>
              </ul>
              {isCurrent ? (
                <button
                  disabled
                  className="mt-8 rounded-xl border border-gray-200 bg-gray-50 py-2.5 text-sm font-semibold text-gray-400"
                >
                  当前套餐
                </button>
              ) : p.price === 0 ? (
                <button
                  disabled
                  className="mt-8 rounded-xl border border-gray-200 bg-gray-50 py-2.5 text-sm font-semibold text-gray-400"
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
                  className={`mt-8 rounded-xl py-2.5 text-sm font-semibold transition ${
                    highlight
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'border border-blue-600 text-blue-600 hover:bg-blue-50'
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
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">确认支付</h3>
            <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm">
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
                <span className="text-lg font-bold text-blue-600">¥{paying.price}</span>
              </div>
            </div>
            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setPaying(null)}
                disabled={processing}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handlePay}
                disabled={processing}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
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

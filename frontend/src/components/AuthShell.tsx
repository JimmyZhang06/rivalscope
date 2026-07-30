import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** 登录/注册页的分屏外壳：左侧品牌区 + 右侧表单区 */
export default function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white">
      {/* 左侧品牌区 */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-cyan-600 p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-white/10 blur-2xl" />
        <Link to="/" className="flex items-center gap-2 text-lg font-bold">
          <span className="text-xl">🔎</span> 竞品调研 Agent
        </Link>
        <div>
          <h2 className="text-3xl font-bold leading-snug">
            AI 替你完成
            <br />
            竞品情报收集与分析
          </h2>
          <ul className="mt-8 space-y-4 text-sm text-blue-100">
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">🧠</span>
              智能规划检索策略，先思考后执行
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">🌐</span>
              联网实时检索，聚合全网情报
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15">📊</span>
              多维度对比分析，生成结构化报告
            </li>
          </ul>
        </div>
        <p className="text-xs text-blue-200">免费版每月 3 次调研 · 无需绑定支付方式</p>
      </div>

      {/* 右侧表单区 */}
      <div className="flex w-full items-center justify-center px-6 lg:w-1/2">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 flex items-center gap-2 text-lg font-bold text-gray-900 lg:hidden">
            <span className="text-xl">🔎</span> 竞品调研 Agent
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="mt-2 text-sm text-gray-500">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  )
}

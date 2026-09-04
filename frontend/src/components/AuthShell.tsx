import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, BrainCircuit, Globe, Search } from 'lucide-react'

/** 登录/注册页的分屏外壳：左侧品牌区 + 右侧表单区 */
export default function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#f8f6f0]">
      {/* 左侧品牌区 */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden border-r border-black/10 bg-[#eeeae0] p-12 text-[#171b1f] lg:flex">
        <img src="/rivalscope-ink-hero.png" alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover object-[70%_center] opacity-70" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(246,243,235,0.98),rgba(246,243,235,0.72)_55%,rgba(246,243,235,0.18))]" />
        <Link to="/" className="relative flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#171b1f] text-white">
            <Search className="h-4 w-4" />
          </span>
          RivalScope
        </Link>
        <div className="relative max-w-lg">
          <p className="mb-5 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#245f8f]">Evidence-led intelligence</p>
          <h2 className="text-4xl font-semibold leading-tight tracking-[-0.045em]">
            让 AI 替你完成
            <br />
            竞品情报收集与分析
          </h2>
          <ul className="mt-9 space-y-4 text-sm text-slate-600">
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/55 text-[#245f8f]">
                <BrainCircuit className="h-4 w-4" />
              </span>
              智能规划检索策略，先思考后执行
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/55 text-[#245f8f]">
                <Globe className="h-4 w-4" />
              </span>
              联网实时检索，聚合全网情报
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/55 text-[#245f8f]">
                <BarChart3 className="h-4 w-4" />
              </span>
              多维度对比分析，生成结构化报告
            </li>
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">免费版每月 3 次调研 · 无需绑定支付方式</p>
      </div>

      {/* 右侧表单区 */}
      <div className="flex w-full items-center justify-center bg-[#f8f6f0] px-6 lg:w-1/2">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 flex items-center gap-2.5 text-lg font-bold tracking-tight text-gray-900 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#171b1f] text-white">
              <Search className="h-4 w-4" />
            </span>
            RivalScope
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
          <p className="mt-2 text-sm text-gray-500">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  )
}

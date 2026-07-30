import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const FEATURES = [
  {
    icon: '🧠',
    title: '智能规划',
    desc: 'AI 自动识别竞品对象，规划多组检索关键词与调研维度，无需人工拆解调研思路。',
  },
  {
    icon: '🌐',
    title: '联网检索',
    desc: '并发调用实时搜索引擎，聚合官网、媒体与社区信息，来源自动分级并保留原文摘录，可信可溯源。',
  },
  {
    icon: '📊',
    title: '深度分析报告',
    desc: '按功能、定价、口碑等维度对比分析，报告全程引用溯源，并生成雷达图、SWOT 等可视化洞察。',
  },
]

const WORKFLOW = [
  { step: '01', title: '输入调研对象', desc: '产品名称 + 可选竞品与调研重点' },
  { step: '02', title: 'Agent 规划检索', desc: '自动生成竞品清单与检索策略' },
  { step: '03', title: '联网收集情报', desc: '并发检索、聚合与去重全网信息' },
  { step: '04', title: '生成调研报告', desc: '多维度对比分析，实时推送进度' },
]

const PRICING = [
  {
    plan: '免费版',
    price: '¥0',
    unit: '/月',
    desc: '个人体验',
    features: ['每月 3 次调研', '4 组检索关键词', '完整调研报告', 'SSE 实时进度'],
    highlight: false,
  },
  {
    plan: '专业版',
    price: '¥99',
    unit: '/月',
    desc: '个人专业用户与小团队',
    features: ['每月 30 次调研', '8 组检索关键词', '更深入的情报覆盖', '优先执行队列'],
    highlight: true,
  },
  {
    plan: '企业版',
    price: '¥399',
    unit: '/月',
    desc: '企业级调研需求',
    features: ['不限调研次数', '12 组检索关键词', '最大情报覆盖', '优先执行队列'],
    highlight: false,
  },
]

export default function LandingPage() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-20 border-b border-gray-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔎</span>
            <span className="text-lg font-bold">竞品调研 Agent</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-gray-600 md:flex">
            <a href="#features" className="hover:text-gray-900">产品能力</a>
            <a href="#workflow" className="hover:text-gray-900">工作流程</a>
            <a href="#pricing" className="hover:text-gray-900">定价</a>
          </nav>
          <div className="flex items-center gap-3">
            {user ? (
              <Link
                to="/app"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                进入工作台
              </Link>
            ) : (
              <>
                <Link to="/login" className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">
                  登录
                </Link>
                <Link
                  to="/register"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                >
                  免费注册
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-50 via-white to-white">
        <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-blue-200/40 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 pb-24 pt-20 text-center">
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            ⚡ AI Agent · 联网检索 · 实时进度
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight md:text-5xl">
            一句话发起竞品调研，
            <span className="bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
              AI 替你完成情报收集与分析
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-gray-500 md:text-lg">
            输入产品名称，Agent 自动规划调研方案、联网检索全网信息、多维度对比分析，
            几分钟内产出可交付的竞品调研报告。
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              to={user ? '/app/new' : '/register'}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700"
            >
              立即免费开始 →
            </Link>
            <a
              href="#workflow"
              className="rounded-xl border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              了解工作流程
            </a>
          </div>
          <p className="mt-4 text-xs text-gray-400">免费版每月 3 次调研，无需绑定支付方式</p>
        </div>
      </section>

      {/* 功能特性 */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="text-center text-3xl font-bold">从检索到报告，全流程自动化</h2>
        <p className="mt-3 text-center text-gray-500">像资深分析师一样思考，像机器一样高效执行</p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
            >
              <span className="text-3xl">{f.icon}</span>
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 工作流程 */}
      <section id="workflow" className="bg-gray-50 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold">四步完成一次专业调研</h2>
          <p className="mt-3 text-center text-gray-500">先思考后决策，先规划后执行</p>
          <div className="mt-12 grid gap-6 md:grid-cols-4">
            {WORKFLOW.map((w) => (
              <div key={w.step} className="relative rounded-2xl border border-gray-100 bg-white p-6">
                <span className="text-3xl font-extrabold text-blue-100">{w.step}</span>
                <h3 className="mt-3 font-semibold">{w.title}</h3>
                <p className="mt-1 text-sm text-gray-500">{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 定价 */}
      <section id="pricing" className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="text-center text-3xl font-bold">简单透明的定价</h2>
        <p className="mt-3 text-center text-gray-500">按需选择，随时升级</p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PRICING.map((p) => (
            <div
              key={p.plan}
              className={`relative flex flex-col rounded-2xl border p-8 ${
                p.highlight
                  ? 'border-blue-600 bg-blue-600 text-white shadow-xl shadow-blue-200'
                  : 'border-gray-200 bg-white'
              }`}
            >
              {p.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-3 py-0.5 text-xs font-bold text-amber-900">
                  最受欢迎
                </span>
              )}
              <h3 className={`text-lg font-semibold ${p.highlight ? 'text-white' : ''}`}>{p.plan}</h3>
              <p className={`mt-1 text-sm ${p.highlight ? 'text-blue-200' : 'text-gray-500'}`}>{p.desc}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold">{p.price}</span>
                <span className={p.highlight ? 'text-blue-200' : 'text-gray-400'}>{p.unit}</span>
              </div>
              <ul className="mt-6 flex-1 space-y-3 text-sm">
                {p.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2">
                    <span className={p.highlight ? 'text-blue-300' : 'text-blue-600'}>✓</span>
                    <span className={p.highlight ? 'text-blue-50' : 'text-gray-600'}>{feat}</span>
                  </li>
                ))}
              </ul>
              <Link
                to={user ? '/app/pricing' : '/register'}
                className={`mt-8 rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition ${
                  p.highlight
                    ? 'bg-white text-blue-700 hover:bg-blue-50'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {p.price === '¥0' ? '免费开始' : '选择该套餐'}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-blue-600 to-cyan-600 py-16">
        <div className="mx-auto max-w-4xl px-4 text-center">
          <h2 className="text-3xl font-bold text-white">现在开始你的第一次 AI 竞品调研</h2>
          <p className="mt-3 text-blue-100">注册即享每月 3 次免费调研额度</p>
          <Link
            to={user ? '/app/new' : '/register'}
            className="mt-8 inline-block rounded-xl bg-white px-8 py-3 text-sm font-semibold text-blue-700 shadow-lg transition hover:bg-blue-50"
          >
            免费注册使用 →
          </Link>
        </div>
      </section>

      {/* 页脚 */}
      <footer className="border-t border-gray-100 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-gray-400 md:flex-row">
          <span>🔎 竞品调研 Agent</span>
          <span>AI 驱动的竞品情报平台 · 仅供演示</span>
        </div>
      </footer>
    </div>
  )
}

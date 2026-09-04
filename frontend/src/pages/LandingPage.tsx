import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  Building2,
  Check,
  CheckCircle2,
  Database,
  FileSearch,
  Globe2,
  Layers3,
  Network,
  Radar,
  Search,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'

const CAPABILITIES = [
  {
    icon: Globe2,
    eyebrow: 'DISCOVER',
    title: '持续捕捉市场信号',
    desc: '聚合官网、媒体与公开资料，自动记录发布时间、访问状态和来源层级。',
    accent: 'bg-cyan-400',
  },
  {
    icon: BrainCircuit,
    eyebrow: 'ANALYZE',
    title: '从证据生成判断',
    desc: '围绕产品、定价、定位和生态关系组织分析，每个关键结论都能回到原始来源。',
    accent: 'bg-orange-400',
  },
  {
    icon: Database,
    eyebrow: 'REMEMBER',
    title: '沉淀团队情报资产',
    desc: '将调研、企业画像、图谱和监测事件统一归档，让一次研究成为可复用知识。',
    accent: 'bg-violet-400',
  },
]

const WORKFLOW = [
  { step: '01', title: '定义问题', desc: '输入研究对象、已知竞品与团队真正关心的决策问题。' },
  { step: '02', title: '规划证据', desc: 'Agent 拆解分析维度，生成检索策略和来源优先级。' },
  { step: '03', title: '采集与核验', desc: '并行收集公开信息，去重、分级并保留可追溯引用。' },
  { step: '04', title: '形成情报', desc: '输出对比报告、画像和关系图谱，并进入持续监测。' },
]

const PRICING = [
  {
    plan: '免费版',
    price: '¥0',
    desc: '适合体验完整调研流程',
    features: ['每月 3 次调研', '完整引用报告', '基础可视化', '实时任务进度'],
    highlight: false,
  },
  {
    plan: '专业版',
    price: '¥99',
    desc: '适合个人分析师与产品团队',
    features: ['每月 30 次调研', '更深检索覆盖', '企业画像与对比', '优先执行队列'],
    highlight: true,
  },
  {
    plan: '企业版',
    price: '¥399',
    desc: '适合持续研究与多人协作',
    features: ['不限调研次数', '团队知识资产', '关系图谱与监测', '成员权限与审计'],
    highlight: false,
  },
]

const SIGNALS = [
  { title: '产品能力页更新', meta: '官网 · 12 分钟前', color: 'bg-cyan-400' },
  { title: '新合作伙伴公告', meta: '新闻稿 · 1 小时前', color: 'bg-orange-400' },
  { title: '企业版定价变动', meta: '定价页 · 昨天', color: 'bg-violet-400' },
]

export default function LandingPage() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-[#f4f6f8] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07111f]/95 text-white backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-3" aria-label="RivalScope 首页">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-950">
              <Search className="h-4 w-4" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#07111f] bg-orange-400" />
            </span>
            <span className="text-lg font-bold tracking-[-0.03em]">RivalScope</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-slate-300 md:flex" aria-label="主导航">
            <a href="#capabilities" className="transition hover:text-white">产品能力</a>
            <a href="#workflow" className="transition hover:text-white">工作流程</a>
            <a href="#pricing" className="transition hover:text-white">定价</a>
            <Link to="/login" className="text-orange-300 transition hover:text-orange-200">演示模式</Link>
          </nav>
          <div className="flex items-center gap-2">
            {!user && <Link to="/login" className="hidden px-3 py-2 text-sm font-medium text-slate-300 hover:text-white sm:block">登录</Link>}
            <Link
              to={user ? '/app' : '/login'}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-orange-100"
            >
              {user ? '进入工作台' : '查看演示'} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-grid relative overflow-hidden bg-[#07111f] text-white">
          <div className="landing-glow pointer-events-none absolute inset-0" />
          <div className="relative mx-auto grid max-w-7xl gap-14 px-4 pb-20 pt-16 sm:px-6 sm:pt-20 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:px-8 lg:pb-28 lg:pt-24">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-200">
                <Radar className="h-3.5 w-3.5" /> 从开放网络到可追溯情报
              </div>
              <h1 className="mt-6 max-w-2xl text-4xl font-bold leading-[1.08] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
                把公开信息，变成
                <span className="mt-1 block text-orange-300">可复核的竞争判断。</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
                RivalScope 将检索、证据治理、企业画像、横向对比与持续监测放进同一条研究链路，让团队看见变化，也看清变化意味着什么。
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  to={user ? '/app/new' : '/login'}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-300 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-orange-200"
                >
                  {user ? '发起新调研' : '使用演示密钥'} <ArrowRight className="h-4 w-4" />
                </Link>
                <a href="#workflow" className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
                  查看研究流程
                </a>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs text-slate-400">
                <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-cyan-300" />结论关联来源</span>
                <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-cyan-300" />研究过程可追踪</span>
                <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-cyan-300" />团队资产可复用</span>
              </div>
            </div>

            <div className="relative lg:pl-5">
              <div className="absolute -inset-4 rounded-[2rem] bg-cyan-400/10 blur-3xl" />
              <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-[#0d1a2b] shadow-2xl shadow-black/40">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <div className="flex gap-1.5" aria-hidden="true"><span className="h-2.5 w-2.5 rounded-full bg-red-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" /></div>
                  <span className="rounded-md bg-white/5 px-2.5 py-1 text-[11px] text-slate-400">INTELLIGENCE / OVERVIEW</span>
                </div>
                <div className="p-4 sm:p-6">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">本周情报脉冲</p>
                      <p className="mt-2 text-xl font-semibold">市场变化正在加速</p>
                      <p className="mt-1 text-xs text-slate-400">过去 7 天捕捉到 18 个有效信号</p>
                    </div>
                    <div className="flex gap-2">
                      <span className="rounded-lg bg-orange-300 px-3 py-2 text-xs font-bold text-slate-950">3 项需关注</span>
                      <span className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">查看报告</span>
                    </div>
                  </div>
                  <div className="mt-6 grid grid-cols-3 gap-2">
                    {[
                      ['18', '新增信号'],
                      ['6', '更新对象'],
                      ['92%', '来源可用'],
                    ].map(([value, label]) => (
                      <div key={label} className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                        <p className="text-xl font-bold tracking-tight sm:text-2xl">{value}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 grid gap-3 md:grid-cols-[1.05fr_0.95fr]">
                    <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-200">信号强度</p>
                        <p className="text-[10px] text-slate-500">最近 6 周</p>
                      </div>
                      <div className="mt-5 flex h-24 items-end gap-2" aria-label="信号强度趋势示意图">
                        {[34, 48, 42, 64, 57, 86, 72, 92].map((height, index) => (
                          <span key={index} className={`flex-1 rounded-t-sm ${index > 5 ? 'bg-orange-300' : 'bg-cyan-300/60'}`} style={{ height: `${height}%` }} />
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4">
                      <p className="text-xs font-semibold text-slate-200">最新变化</p>
                      <div className="mt-3 space-y-3">
                        {SIGNALS.map((signal) => (
                          <div key={signal.title} className="flex gap-2.5">
                            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${signal.color}`} />
                            <div className="min-w-0"><p className="truncate text-xs font-medium text-slate-200">{signal.title}</p><p className="mt-0.5 text-[10px] text-slate-500">{signal.meta}</p></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:grid-cols-3 sm:px-6 lg:px-8">
            {[
              [ShieldCheck, '证据优先', '保留来源、时间和引用关系'],
              [Layers3, '统一资产', '报告、画像、图谱集中管理'],
              [Zap, '持续感知', '从一次调研延伸到长期监测'],
            ].map(([Icon, title, desc]) => {
              const ItemIcon = Icon as typeof ShieldCheck
              return <div key={title as string} className="flex items-center gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><ItemIcon className="h-5 w-5" /></span><div><p className="text-sm font-bold text-slate-900">{title as string}</p><p className="mt-0.5 text-xs text-slate-500">{desc as string}</p></div></div>
            })}
          </div>
        </section>

        <section id="capabilities" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">Research system</p>
            <h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] text-slate-950 sm:text-4xl">不是信息堆积，而是一套持续运转的研究系统。</h2>
            <p className="mt-4 text-base leading-7 text-slate-600">从发现变化到形成判断，每一步都保留上下文，让团队不再反复从零开始。</p>
          </div>
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {CAPABILITIES.map((item, index) => (
              <article key={item.title} className={`group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl motion-reduce:transform-none ${index === 1 ? 'lg:mt-8' : ''}`}>
                <span className={`absolute inset-x-0 top-0 h-1 ${item.accent}`} />
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-white"><item.icon className="h-5 w-5" /></span>
                  <span className="text-[10px] font-bold tracking-[0.2em] text-slate-400">{item.eyebrow}</span>
                </div>
                <h3 className="mt-8 text-xl font-bold tracking-tight">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.desc}</p>
                <div className="mt-8 border-t border-slate-100 pt-5 text-xs font-semibold text-slate-500">{String(index + 1).padStart(2, '0')} / 核心能力</div>
              </article>
            ))}
          </div>
        </section>

        <section id="workflow" className="bg-white py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
              <div className="lg:sticky lg:top-28">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Evidence workflow</p>
                <h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">把研究过程，变成人人看得懂的证据链。</h2>
                <p className="mt-4 max-w-md text-base leading-7 text-slate-600">调研不再是一份无法追问的结果，而是从问题、策略、来源到结论的完整记录。</p>
                <div className="mt-8 inline-flex items-center gap-2 rounded-xl bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-900"><FileSearch className="h-4 w-4" />支持实时查看任务阶段</div>
              </div>
              <ol className="border-l border-slate-200 pl-5 sm:pl-8">
                {WORKFLOW.map((item, index) => (
                  <li key={item.step} className="relative pb-10 last:pb-0">
                    <span className={`absolute -left-[2.05rem] top-0 flex h-7 w-7 items-center justify-center rounded-full border-4 border-white text-[10px] font-bold text-white sm:-left-[2.95rem] ${index === 3 ? 'bg-orange-500' : 'bg-slate-950'}`}>{item.step}</span>
                    <div className="rounded-2xl border border-slate-200 bg-[#f8fafc] p-5 sm:p-6">
                      <div className="flex items-start gap-4"><span className="text-3xl font-black tracking-[-0.06em] text-slate-200">{item.step}</span><div><h3 className="text-lg font-bold">{item.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{item.desc}</p></div></div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="overflow-hidden rounded-3xl bg-[#0a1726] text-white shadow-2xl shadow-slate-300/50">
            <div className="grid lg:grid-cols-[1fr_0.92fr]">
              <div className="p-7 sm:p-10 lg:p-14">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">Decision-ready output</p>
                <h2 className="mt-4 max-w-xl text-3xl font-bold tracking-[-0.035em] sm:text-4xl">让每一份报告，都能回答“依据是什么”。</h2>
                <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">结论与来源保持引用关系，关键事件进入时间线，差异进入对比结构，方便复核、分享与继续追问。</p>
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {[
                    [BarChart3, '多维度对比与评分'],
                    [Network, '企业与产业关系图谱'],
                    [Building2, '标准化企业画像'],
                    [ShieldCheck, '来源分级与审计记录'],
                  ].map(([Icon, label]) => {
                    const FeatureIcon = Icon as typeof BarChart3
                    return <div key={label as string} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200"><FeatureIcon className="h-4 w-4 text-violet-300" />{label as string}</div>
                  })}
                </div>
              </div>
              <div className="border-t border-white/10 bg-white/[0.035] p-7 sm:p-10 lg:border-l lg:border-t-0">
                <div className="rounded-2xl border border-white/10 bg-[#07111f] p-5">
                  <div className="flex items-center justify-between"><p className="text-sm font-bold">竞争态势摘要</p><span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">已核验</span></div>
                  <div className="mt-6 space-y-5">
                    {[
                      ['产品完整度', 86, 'bg-cyan-300'],
                      ['市场势能', 72, 'bg-orange-300'],
                      ['生态协同', 64, 'bg-violet-300'],
                      ['企业适配', 91, 'bg-emerald-300'],
                    ].map(([label, value, color]) => (
                      <div key={label as string}><div className="mb-2 flex justify-between text-xs"><span className="text-slate-400">{label as string}</span><span className="font-bold text-white">{value as number}</span></div><div className="h-1.5 rounded-full bg-white/10"><div className={`h-full rounded-full ${color as string}`} style={{ width: `${value}%` }} /></div></div>
                    ))}
                  </div>
                  <div className="mt-6 rounded-xl border border-orange-300/15 bg-orange-300/5 p-4"><p className="text-xs font-bold text-orange-200">关键判断</p><p className="mt-2 text-xs leading-5 text-slate-400">竞争重心正从单点能力转向工作流整合，生态协同将成为下一阶段差异化来源。</p><p className="mt-3 text-[10px] text-slate-600">关联 8 条来源 · 更新于今天</p></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" className="border-y border-slate-200 bg-white py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center"><p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">Plans</p><h2 className="mt-4 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">从一次研究开始，按团队节奏扩展。</h2></div>
            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {PRICING.map((item) => (
                <article key={item.plan} className={`relative flex flex-col rounded-2xl border p-6 sm:p-7 ${item.highlight ? 'border-slate-950 bg-slate-950 text-white shadow-xl' : 'border-slate-200 bg-white'}`}>
                  {item.highlight && <span className="absolute right-5 top-5 rounded-full bg-orange-300 px-2.5 py-1 text-[10px] font-bold text-slate-950">推荐</span>}
                  <h3 className="text-lg font-bold">{item.plan}</h3><p className={`mt-2 text-sm ${item.highlight ? 'text-slate-400' : 'text-slate-500'}`}>{item.desc}</p>
                  <p className="mt-7 text-4xl font-black tracking-[-0.05em]">{item.price}<span className={`ml-1 text-sm font-medium ${item.highlight ? 'text-slate-500' : 'text-slate-400'}`}>/ 月</span></p>
                  <ul className="mt-7 flex-1 space-y-3">
                    {item.features.map((feature) => <li key={feature} className={`flex items-center gap-2.5 text-sm ${item.highlight ? 'text-slate-300' : 'text-slate-600'}`}><Check className={`h-4 w-4 ${item.highlight ? 'text-orange-300' : 'text-cyan-700'}`} />{feature}</li>)}
                  </ul>
                  <Link to={user ? '/app/pricing' : '/login'} className={`mt-8 rounded-xl px-4 py-3 text-center text-sm font-bold transition ${item.highlight ? 'bg-orange-300 text-slate-950 hover:bg-orange-200' : 'border border-slate-300 text-slate-800 hover:border-slate-500'}`}>{item.plan === '免费版' ? '免费开始' : '选择方案'}</Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-orange-300">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:px-8">
            <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-900/70">Demo access</p><h2 className="mt-3 text-3xl font-black tracking-[-0.04em] text-slate-950">先进入工作台，再决定是否接入真实数据。</h2><p className="mt-3 text-sm text-slate-700">登录页输入演示密钥，即可浏览带示例数据的完整情报总览。</p></div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center"><code className="rounded-xl border border-orange-500/30 bg-white/60 px-4 py-3 text-sm font-bold text-slate-900">RIVALSCOPE-DEMO-2026</code><Link to="/login" className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800">进入演示 <ArrowRight className="h-4 w-4" /></Link></div>
          </div>
        </section>
      </main>

      <footer className="bg-[#07111f] text-slate-400">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-end md:justify-between lg:px-8">
          <div><div className="flex items-center gap-2.5 text-white"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-950"><Search className="h-4 w-4" /></span><span className="font-bold">RivalScope</span></div><p className="mt-3 max-w-md text-xs leading-5">面向产品、市场、战略与研究团队的可追溯竞争情报平台。</p></div>
          <div className="flex flex-wrap gap-5 text-xs"><a href="#capabilities" className="hover:text-white">产品能力</a><a href="#workflow" className="hover:text-white">工作流程</a><Link to="/login" className="hover:text-white">演示登录</Link><span>© 2026 RivalScope</span></div>
        </div>
      </footer>
    </div>
  )
}

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
  Search,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'

const CAPABILITIES = [
  { icon: Globe2, eyebrow: 'DISCOVER', title: '捕捉变化', desc: '聚合官网、媒体与公开资料，自动记录发布时间、访问状态和来源层级。' },
  { icon: BrainCircuit, eyebrow: 'ANALYZE', title: '形成判断', desc: '围绕产品、定价、定位和生态组织分析，每个关键结论都能回到原始证据。' },
  { icon: Database, eyebrow: 'REMEMBER', title: '沉淀资产', desc: '将调研、企业画像、图谱和监测事件统一归档，让一次研究持续产生价值。' },
]

const WORKFLOW = [
  { step: '01', title: '定义问题', desc: '输入研究对象、已知竞品与团队真正关心的决策问题。' },
  { step: '02', title: '规划证据', desc: 'Agent 拆解分析维度，生成检索策略和来源优先级。' },
  { step: '03', title: '采集核验', desc: '并行收集公开信息，去重、分级并保留可追溯引用。' },
  { step: '04', title: '形成情报', desc: '输出对比报告、画像和关系图谱，并进入持续监测。' },
]

const PRICING = [
  { plan: '免费版', price: '¥0', desc: '适合体验完整调研流程', features: ['每月 3 次调研', '完整引用报告', '基础可视化', '实时任务进度'], highlight: false },
  { plan: '专业版', price: '¥99', desc: '适合个人分析师与产品团队', features: ['每月 30 次调研', '更深检索覆盖', '企业画像与对比', '优先执行队列'], highlight: true },
  { plan: '企业版', price: '¥399', desc: '适合持续研究与多人协作', features: ['不限调研次数', '团队知识资产', '关系图谱与监测', '成员权限与审计'], highlight: false },
]

export default function LandingPage() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-[#f3f0e8] text-[#171b1f]">
      <header className="sticky top-0 z-40 border-b border-black/10 bg-[#f8f6f0]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-3" aria-label="RivalScope 首页">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#171b1f] text-white"><Search className="h-3.5 w-3.5" /></span>
            <span className="text-base font-semibold tracking-[-0.02em]">RivalScope</span>
          </Link>
          <nav className="hidden items-center gap-8 text-[13px] font-medium text-slate-600 md:flex" aria-label="主导航">
            <a href="#capabilities" className="transition hover:text-black">产品能力</a>
            <a href="#workflow" className="transition hover:text-black">研究流程</a>
            <a href="#pricing" className="transition hover:text-black">定价</a>
            <Link to="/login" className="text-[#245f8f] transition hover:text-[#17446a]">演示模式</Link>
          </nav>
          <div className="flex items-center gap-2">
            {!user && <Link to="/login" className="hidden px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-black sm:block">登录</Link>}
            <Link to={user ? '/app' : '/login'} className="inline-flex items-center gap-2 rounded-full bg-[#171b1f] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-black">
              {user ? '进入工作台' : '查看演示'} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative isolate min-h-[720px] overflow-hidden border-b border-black/10 bg-[#eeeae0]">
          <img src="/rivalscope-ink-hero.png" alt="层叠水墨山峦" className="absolute inset-0 -z-20 h-full w-full object-cover object-[64%_center]" />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(247,244,236,0.98)_0%,rgba(247,244,236,0.92)_35%,rgba(247,244,236,0.36)_64%,rgba(247,244,236,0.04)_100%)]" />
          <div className="mx-auto flex min-h-[720px] max-w-7xl flex-col justify-between px-4 pb-8 pt-16 sm:px-6 sm:pt-20 lg:px-8 lg:pt-24">
            <div className="max-w-[650px]">
              <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#245f8f]"><span className="h-px w-9 bg-[#245f8f]" /> Competitive intelligence, clarified</div>
              <h1 className="mt-7 text-[2.8rem] font-semibold leading-[1.06] tracking-[-0.055em] text-[#111519] sm:text-6xl lg:text-[4.5rem]">
                看见变化，<span className="block font-normal text-slate-600">洞察变化背后的方向。</span>
              </h1>
              <p className="mt-7 max-w-xl text-base leading-8 text-slate-600 sm:text-lg">RivalScope 将开放网络中的碎片信号，整理为有来源、有上下文、可复核的竞争情报，让团队更从容地做出下一步判断。</p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link to={user ? '/app/new' : '/login'} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#171b1f] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-black">
                  {user ? '发起新调研' : '使用演示密钥'} <ArrowRight className="h-4 w-4" />
                </Link>
                <a href="#workflow" className="inline-flex items-center justify-center rounded-full border border-black/20 bg-white/35 px-6 py-3.5 text-sm font-semibold text-[#171b1f] backdrop-blur-sm transition hover:bg-white/60">了解研究流程</a>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs text-slate-600">
                {['结论关联来源', '过程实时可追踪', '知识长期可复用'].map((item) => <span key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#245f8f]" />{item}</span>)}
              </div>
            </div>

            <div className="mt-16 grid overflow-hidden rounded-2xl border border-white/60 bg-[#f8f6f0]/75 shadow-[0_18px_60px_rgba(28,34,40,0.08)] backdrop-blur-md sm:grid-cols-3">
              {[
                ['92%', '来源持续可用', '每条信息保留出处与时间'],
                ['18', '本周有效信号', '产品、定价与生态变化'],
                ['1 条链路', '从发现到决策', '研究过程完整留痕'],
              ].map(([value, title, desc], index) => (
                <div key={title} className={`p-5 sm:p-6 ${index > 0 ? 'border-t border-black/10 sm:border-l sm:border-t-0' : ''}`}>
                  <p className="text-2xl font-semibold tracking-[-0.04em] text-[#171b1f]">{value}</p><p className="mt-1 text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-slate-500">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-black/10 bg-[#f8f6f0]">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-9 sm:grid-cols-3 sm:px-6 lg:px-8">
            {[
              [ShieldCheck, '证据优先', '保留来源、时间和引用关系'],
              [Layers3, '统一资产', '报告、画像、图谱集中管理'],
              [Zap, '持续感知', '从一次调研延伸到长期监测'],
            ].map(([Icon, title, desc]) => {
              const ItemIcon = Icon as typeof ShieldCheck
              return <div key={title as string} className="flex items-center gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white/60 text-[#245f8f]"><ItemIcon className="h-[18px] w-[18px]" /></span><div><p className="text-sm font-semibold">{title as string}</p><p className="mt-1 text-xs text-slate-500">{desc as string}</p></div></div>
            })}
          </div>
        </section>

        <section id="capabilities" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:gap-20">
            <div><p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#245f8f]">Research system</p><h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">让情报像水脉一样，持续汇聚。</h2><p className="mt-5 max-w-md text-base leading-7 text-slate-600">更少的界面噪音，更清楚的证据关系。从发现变化到形成判断，每一步都保留上下文。</p></div>
            <div className="border-t border-black/15">
              {CAPABILITIES.map((item, index) => (
                <article key={item.title} className="group grid gap-5 border-b border-black/15 py-7 sm:grid-cols-[70px_1fr_1.4fr] sm:items-start">
                  <span className="text-xs font-medium text-slate-400">0{index + 1}</span>
                  <div><span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#245f8f] text-white"><item.icon className="h-4 w-4" /></span><h3 className="mt-4 text-lg font-semibold">{item.title}</h3></div>
                  <div><p className="text-[10px] font-semibold tracking-[0.22em] text-slate-400">{item.eyebrow}</p><p className="mt-3 text-sm leading-6 text-slate-600">{item.desc}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="border-y border-black/10 bg-[#e9e6dd] py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end"><div><p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#245f8f]">Evidence workflow</p><h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">四步，形成可追溯的判断。</h2></div><div className="inline-flex items-center gap-2 text-sm font-medium text-slate-600"><FileSearch className="h-4 w-4 text-[#245f8f]" />任务阶段实时可见</div></div>
            <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-black/10 bg-black/10 lg:grid-cols-4">
              {WORKFLOW.map((item, index) => (
                <li key={item.step} className="relative min-h-64 bg-[#f6f3eb] p-7"><span className="text-[11px] font-semibold tracking-[0.2em] text-[#245f8f]">{item.step}</span><h3 className="mt-16 text-xl font-semibold">{item.title}</h3><p className="mt-3 text-sm leading-6 text-slate-600">{item.desc}</p>{index < WORKFLOW.length - 1 && <ArrowRight className="absolute bottom-7 right-7 hidden h-4 w-4 text-slate-400 lg:block" />}</li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="overflow-hidden rounded-3xl bg-[#171b1f] text-white shadow-[0_32px_80px_rgba(21,25,29,0.16)]">
            <div className="grid lg:grid-cols-[1fr_0.88fr]">
              <div className="p-7 sm:p-10 lg:p-14">
                <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#7cb1d8]">Decision-ready output</p><h2 className="mt-5 max-w-xl text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">不只给答案，也呈现答案从何而来。</h2><p className="mt-5 max-w-xl text-base leading-7 text-slate-300">结论与来源保持引用关系，关键事件进入时间线，差异进入对比结构，方便复核、分享与继续追问。</p>
                <div className="mt-9 grid gap-y-5 sm:grid-cols-2">
                  {[[BarChart3, '多维度对比与评分'], [Network, '企业与产业关系图谱'], [Building2, '标准化企业画像'], [ShieldCheck, '来源分级与审计记录']].map(([Icon, label]) => {
                    const FeatureIcon = Icon as typeof BarChart3
                    return <div key={label as string} className="flex items-center gap-3 text-sm text-slate-200"><FeatureIcon className="h-4 w-4 text-[#7cb1d8]" />{label as string}</div>
                  })}
                </div>
              </div>
              <div className="border-t border-white/10 bg-white/[0.035] p-7 sm:p-10 lg:border-l lg:border-t-0">
                <div className="border-y border-white/15 py-5">
                  <div className="flex items-center justify-between"><p className="text-sm font-semibold">竞争态势摘要</p><span className="text-[10px] font-semibold tracking-widest text-[#84c9a6]">已核验</span></div>
                  <div className="mt-7 space-y-6">
                    {[['产品完整度', 86], ['市场势能', 72], ['生态协同', 64], ['企业适配', 91]].map(([label, value]) => (
                      <div key={label as string}><div className="mb-2 flex justify-between text-xs"><span className="text-slate-400">{label as string}</span><span className="font-semibold text-white">{value as number}</span></div><div className="h-px bg-white/15"><div className="h-px bg-[#7cb1d8]" style={{ width: `${value}%` }} /></div></div>
                    ))}
                  </div>
                  <div className="mt-8 border-l border-[#7cb1d8] pl-4"><p className="text-xs font-semibold text-[#a7cde8]">关键判断</p><p className="mt-2 text-xs leading-5 text-slate-400">竞争重心正从单点能力转向工作流整合，生态协同将成为下一阶段差异化来源。</p><p className="mt-3 text-[10px] text-slate-600">关联 8 条来源 · 更新于今天</p></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" className="border-t border-black/10 bg-[#f8f6f0] py-20 lg:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center"><p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#245f8f]">Plans</p><h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">从一次研究开始。</h2></div>
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-black/10 bg-black/10 lg:grid-cols-3">
              {PRICING.map((item) => (
                <article key={item.plan} className={`relative flex flex-col p-7 sm:p-8 ${item.highlight ? 'bg-[#e7edf0]' : 'bg-[#f8f6f0]'}`}>
                  {item.highlight && <span className="absolute right-6 top-6 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#245f8f]">推荐</span>}
                  <h3 className="text-lg font-semibold">{item.plan}</h3><p className="mt-2 text-sm text-slate-500">{item.desc}</p><p className="mt-8 text-4xl font-semibold tracking-[-0.05em]">{item.price}<span className="ml-1 text-sm font-normal text-slate-400">/ 月</span></p>
                  <ul className="mt-8 flex-1 space-y-3">{item.features.map((feature) => <li key={feature} className="flex items-center gap-2.5 text-sm text-slate-600"><Check className="h-4 w-4 text-[#245f8f]" />{feature}</li>)}</ul>
                  <Link to={user ? '/app/pricing' : '/login'} className={`mt-9 rounded-full px-4 py-3 text-center text-sm font-semibold transition ${item.highlight ? 'bg-[#171b1f] text-white hover:bg-black' : 'border border-black/20 text-[#171b1f] hover:bg-white'}`}>{item.plan === '免费版' ? '免费开始' : '选择方案'}</Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#245f8f] text-white">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-4 py-14 sm:px-6 lg:flex-row lg:items-center lg:px-8">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-blue-200">Demo access</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">先进入工作台，再决定是否接入真实数据。</h2><p className="mt-3 text-sm text-blue-100">登录页输入演示密钥，即可浏览完整的情报总览。</p></div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center"><code className="rounded-full border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white">RIVALSCOPE-DEMO-2026</code><Link to="/login" className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#17446a] hover:bg-[#f8f6f0]">进入演示 <ArrowRight className="h-4 w-4" /></Link></div>
          </div>
        </section>
      </main>

      <footer className="bg-[#171b1f] text-slate-400">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-end md:justify-between lg:px-8">
          <div><div className="flex items-center gap-2.5 text-white"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#171b1f]"><Search className="h-3.5 w-3.5" /></span><span className="font-semibold">RivalScope</span></div><p className="mt-3 max-w-md text-xs leading-5">面向产品、市场、战略与研究团队的可追溯竞争情报平台。</p></div>
          <div className="flex flex-wrap gap-5 text-xs"><a href="#capabilities" className="hover:text-white">产品能力</a><a href="#workflow" className="hover:text-white">研究流程</a><Link to="/login" className="hover:text-white">演示登录</Link><span>© 2026 RivalScope</span></div>
        </div>
      </footer>
    </div>
  )
}

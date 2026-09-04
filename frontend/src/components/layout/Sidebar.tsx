import { useEffect, useState } from 'react'
import {
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  Search,
  X,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import type { Plan, User } from '../../api/types'
import PlanBadge from '../PlanBadge'
import {
  ACCOUNT_NAVIGATION,
  ADMIN_NAVIGATION,
  ANALYSIS_NAVIGATION,
  ASSISTANT_NAVIGATION,
  PLATFORM_NAVIGATION,
} from './navigation'
import type { NavigationItem } from './navigation'

interface SidebarProps {
  collapsed: boolean
  mobileOpen: boolean
  user: User | null
  effectivePlan: Plan | null
  onCloseMobile: () => void
  onToggleCollapsed: () => void
}

function NavigationLink({ item, collapsed, onNavigate }: {
  item: NavigationItem
  collapsed: boolean
  onNavigate: () => void
}) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={({ isActive }) =>
        `group relative flex min-h-10 items-center rounded-lg text-sm font-medium transition motion-reduce:transition-none ${
          collapsed ? 'justify-center px-2' : 'gap-3 px-3'
        } ${
          isActive
            ? 'bg-[#f8f6f0] text-[#171b1f] shadow-[0_8px_24px_rgba(0,0,0,0.18)] before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-[#245f8f]'
            : 'text-slate-400 hover:bg-white/[0.08] hover:text-white'
        }`
      }
    >
      <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  )
}

function SectionLabel({ children, collapsed }: { children: string; collapsed: boolean }) {
  if (collapsed) return <div className="mx-3 my-2 border-t border-white/10" />
  return <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#7cb1d8]/65">{children}</p>
}

export default function Sidebar({
  collapsed,
  mobileOpen,
  user,
  effectivePlan,
  onCloseMobile,
  onToggleCollapsed,
}: SidebarProps) {
  const [analysisOpen, setAnalysisOpen] = useState(() => localStorage.getItem('app-analysis-nav-open') !== 'false')

  useEffect(() => {
    localStorage.setItem('app-analysis-nav-open', String(analysisOpen))
  }, [analysisOpen])

  useEffect(() => {
    if (!mobileOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseMobile()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpen, onCloseMobile])

  const hideLabels = collapsed && !mobileOpen
  const navWidth = hideLabels ? 'lg:w-20' : 'lg:w-72'

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="关闭导航"
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-[1px] lg:hidden"
        />
      )}
      <aside
        aria-label="主导航"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-[#171b1f] shadow-xl transition-transform duration-200 motion-reduce:transition-none lg:z-30 lg:translate-x-0 lg:shadow-none ${navWidth} ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <img src="/rivalscope-ink-hero.png" alt="" className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] w-full object-cover object-[72%_center] opacity-[0.11] grayscale" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(23,27,31,1)_0%,rgba(23,27,31,0.92)_48%,rgba(23,27,31,0.72)_100%)]" />
        <div className={`relative z-10 flex h-16 shrink-0 items-center border-b border-white/10 ${hideLabels ? 'justify-center px-2' : 'justify-between px-4'}`}>
          <NavLink to="/app" end onClick={onCloseMobile} className="flex min-w-0 items-center gap-2.5 text-white">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#171b1f]">
              <Search className="h-4 w-4" aria-hidden="true" />
            </span>
            {!hideLabels && (
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold tracking-wide">RivalScope</span>
                <span className="block truncate text-[9px] uppercase tracking-[0.16em] text-[#7cb1d8]/70">Intelligence system</span>
              </span>
            )}
          </NavLink>
          {!hideLabels && (
            <button type="button" aria-label="关闭导航" onClick={onCloseMobile} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <nav className="relative z-10 flex-1 overflow-y-auto px-3 py-4">
          <SectionLabel collapsed={hideLabels}>平台</SectionLabel>
          <div className="space-y-1">
            {PLATFORM_NAVIGATION.map((item) => <NavigationLink key={item.to} item={item} collapsed={hideLabels} onNavigate={onCloseMobile} />)}
          </div>

          <div className="mt-3">
            {hideLabels ? (
              <SectionLabel collapsed>分析工作台</SectionLabel>
            ) : (
              <button
                type="button"
                aria-expanded={analysisOpen}
                onClick={() => setAnalysisOpen((value) => !value)}
                className="flex w-full items-center justify-between rounded-md px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-300"
              >
                分析工作台
                <ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${analysisOpen ? '' : '-rotate-90'}`} />
              </button>
            )}
            {(analysisOpen || hideLabels) && (
              <div className="mt-1 space-y-1">
                {ANALYSIS_NAVIGATION.map((item) => <NavigationLink key={item.to} item={item} collapsed={hideLabels} onNavigate={onCloseMobile} />)}
              </div>
            )}
          </div>

          <div className="mt-3">
            <SectionLabel collapsed={hideLabels}>助手</SectionLabel>
            <NavigationLink item={ASSISTANT_NAVIGATION} collapsed={hideLabels} onNavigate={onCloseMobile} />
          </div>

          <div className="mt-3 border-t border-white/10 pt-2">
            {!hideLabels && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-600">账户</p>}
            <div className="space-y-1">
              {ACCOUNT_NAVIGATION.map((item) => <NavigationLink key={item.to} item={item} collapsed={hideLabels} onNavigate={onCloseMobile} />)}
              {user?.role === 'admin' && ADMIN_NAVIGATION.map((item) => <NavigationLink key={item.to} item={item} collapsed={hideLabels} onNavigate={onCloseMobile} />)}
            </div>
          </div>
        </nav>

        <div className="relative z-10 shrink-0 border-t border-white/10 p-3">
          <NavLink
            to="/app/account"
            onClick={onCloseMobile}
            title={hideLabels ? '账户设置' : undefined}
            className={`flex items-center rounded-2xl border border-white/10 bg-white/[0.045] p-2.5 text-slate-300 transition hover:bg-white/[0.08] motion-reduce:transition-none ${hideLabels ? 'justify-center' : 'gap-3'}`}
          >
            {user?.avatar?.startsWith('data:image/') ? (
              <img src={user.avatar} alt="头像" className="h-9 w-9 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#245f8f] text-sm font-bold text-white">
                {(user?.nickname || user?.email || '?').slice(0, 1).toUpperCase()}
              </span>
            )}
            {!hideLabels && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">{user?.nickname || user?.email}</span>
                {user && <span className="mt-1 block"><PlanBadge plan={effectivePlan ?? user.plan} /></span>}
              </span>
            )}
          </NavLink>
          <div className="mt-1 flex">
            <button
              type="button"
              aria-label="折叠侧栏"
              onClick={onToggleCollapsed}
              className="hidden flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-500 hover:bg-white/[0.07] hover:text-white lg:flex"
            >
              {hideLabels ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> 折叠侧栏</>}
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

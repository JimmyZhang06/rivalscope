import {
  Activity,
  Bot,
  Building2,
  Database,
  FileSearch,
  Gem,
  LayoutDashboard,
  Network,
  RadioTower,
  Scale,
  Sparkles,
  UserRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavigationItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export const PLATFORM_NAVIGATION: NavigationItem[] = [
  { to: '/app', label: '情报总览', icon: LayoutDashboard, end: true },
  { to: '/app/intelligence', label: '情报事件', icon: Activity },
  { to: '/app/competitors', label: '关注对象', icon: Building2 },
  { to: '/app/assets', label: '情报资产', icon: Database },
  { to: '/app/trackers', label: '监测中心', icon: RadioTower },
]

export const ANALYSIS_NAVIGATION: NavigationItem[] = [
  { to: '/app/new', label: '专题调研', icon: FileSearch },
  { to: '/app/profiles', label: '画像与对比', icon: Sparkles },
  { to: '/app/graph', label: '关系图谱', icon: Network },
]

export const ASSISTANT_NAVIGATION: NavigationItem = {
  to: '/app/assistant',
  label: 'AI 助手',
  icon: Bot,
}

export const ACCOUNT_NAVIGATION: NavigationItem[] = [
  { to: '/app/pricing', label: '套餐与用量', icon: Gem },
  { to: '/app/account', label: '账号与企业', icon: UserRound },
]

export const CREATE_ACTIONS: NavigationItem[] = [
  { to: '/app/competitors', label: '添加关注对象', icon: Building2 },
  { to: '/app/trackers', label: '创建监测', icon: RadioTower },
  { to: '/app/new', label: '发起专题调研', icon: FileSearch },
  { to: '/app/profiles', label: '生成画像', icon: Sparkles },
  { to: '/app/graph', label: '构建图谱', icon: Network },
]

const PAGE_TITLES: Array<{ test: (pathname: string) => boolean; title: string }> = [
  { test: (path) => path === '/app', title: '情报总览' },
  { test: (path) => path.startsWith('/app/intelligence'), title: '情报事件' },
  { test: (path) => path.startsWith('/app/competitors'), title: '关注对象' },
  { test: (path) => path.startsWith('/app/assets'), title: '情报资产' },
  { test: (path) => path.startsWith('/app/trackers'), title: '监测中心' },
  { test: (path) => path.startsWith('/app/profiles/compare'), title: '横向对比' },
  { test: (path) => path.startsWith('/app/profiles/templates'), title: '画像模板' },
  { test: (path) => path.startsWith('/app/profiles/tasks'), title: '画像任务' },
  { test: (path) => path.startsWith('/app/profiles'), title: '画像与对比' },
  { test: (path) => path.startsWith('/app/tasks'), title: '调研记录' },
  { test: (path) => path.startsWith('/app/new'), title: '专题调研' },
  { test: (path) => path.startsWith('/app/graph'), title: '关系图谱' },
  { test: (path) => path.startsWith('/app/assistant'), title: 'AI 助手' },
  { test: (path) => path.startsWith('/app/pricing'), title: '套餐与用量' },
  { test: (path) => path.startsWith('/app/account') || path.startsWith('/app/org'), title: '账号与企业' },
  { test: (path) => path.startsWith('/app/admin/audit-logs'), title: '审计日志' },
  { test: (path) => path.startsWith('/app/admin'), title: '管理后台' },
]

export function getPageTitle(pathname: string) {
  return PAGE_TITLES.find((page) => page.test(pathname))?.title ?? '竞争情报平台'
}

export const ADMIN_NAVIGATION: NavigationItem[] = [
  { to: '/app/admin', label: '管理后台', icon: Scale, end: true },
  { to: '/app/admin/audit-logs', label: '审计日志', icon: Activity },
]

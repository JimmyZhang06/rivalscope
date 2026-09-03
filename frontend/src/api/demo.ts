import type { User } from './types'

const DEMO_SESSION_KEY = 'rivalscope_demo_session'
export const DEMO_ACCESS_KEY = 'RIVALSCOPE-DEMO-2026'

export const DEMO_USER: User = {
  id: 'demo-user',
  email: 'demo@rivalscope.local',
  nickname: '演示访客',
  avatar: '',
  role: 'user',
  plan: 'pro',
  org_id: 'demo-org',
  org_role: 'owner',
  plan_expires_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
}

export function isDemoMode(): boolean {
  return localStorage.getItem(DEMO_SESSION_KEY) === 'active'
}

export function startDemoSession(accessKey: string): User {
  if (accessKey.trim() !== DEMO_ACCESS_KEY) {
    throw new Error('演示访问密钥不正确')
  }
  localStorage.setItem(DEMO_SESSION_KEY, 'active')
  return DEMO_USER
}

export function endDemoSession(): void {
  localStorage.removeItem(DEMO_SESSION_KEY)
}

const demoEvents = [
  {
    id: 'demo-event-1',
    event_type: 'research',
    status: 'completed',
    title: 'AI 助手市场格局更新',
    summary: '已整理主要产品定位、价格变化与企业客户策略。',
    source_id: 'demo-task-1',
    href: '/app/tasks',
    occurred_at: '2026-09-03T08:40:00.000Z',
    updated_at: '2026-09-03T08:40:00.000Z',
    context: {},
  },
  {
    id: 'demo-event-2',
    event_type: 'tracker',
    status: 'running',
    title: '核心竞品官网变化监测',
    summary: '正在检查产品页面、定价与最新公告。',
    source_id: 'demo-tracker-1',
    href: '/app/trackers',
    occurred_at: '2026-09-03T07:15:00.000Z',
    updated_at: '2026-09-03T09:05:00.000Z',
    context: {},
  },
  {
    id: 'demo-event-3',
    event_type: 'graph',
    status: 'completed',
    title: '生成式 AI 产业关系图谱',
    summary: '新增 12 个实体与 19 条合作、投资及供应关系。',
    source_id: 'demo-graph-1',
    href: '/app/graph',
    occurred_at: '2026-09-02T11:20:00.000Z',
    updated_at: '2026-09-02T11:20:00.000Z',
    context: {},
  },
]

const demoAssets = [
  {
    id: 'demo-asset-1',
    type: 'research_task',
    source_id: 'demo-task-1',
    title: 'AI 助手市场格局报告',
    summary: '主要厂商、产品能力与商业化路径对比。',
    status: 'completed',
    org_id: 'demo-org',
    owner_id: 'demo-user',
    detail_path: '/app/tasks',
    attributes: {},
    created_at: '2026-09-03T08:40:00.000Z',
    updated_at: '2026-09-03T08:40:00.000Z',
  },
  {
    id: 'demo-asset-2',
    type: 'competitor',
    source_id: 'demo-competitor-1',
    title: '示例竞品 A',
    summary: '企业级 AI 研究与知识工作平台。',
    status: 'active',
    org_id: 'demo-org',
    owner_id: 'demo-user',
    detail_path: '/app/competitors',
    attributes: {},
    created_at: '2026-09-01T04:00:00.000Z',
    updated_at: '2026-09-03T06:20:00.000Z',
  },
  {
    id: 'demo-asset-3',
    type: 'graph_project',
    source_id: 'demo-graph-1',
    title: '生成式 AI 产业关系图谱',
    summary: '关键企业、模型、云平台与生态伙伴关系。',
    status: 'completed',
    org_id: 'demo-org',
    owner_id: 'demo-user',
    detail_path: '/app/graph',
    attributes: {},
    created_at: '2026-09-02T11:20:00.000Z',
    updated_at: '2026-09-02T11:20:00.000Z',
  },
]

const demoTrackers = [
  {
    id: 'demo-tracker-1',
    org_id: 'demo-org',
    creator_id: 'demo-user',
    product_name: '核心竞品官网变化监测',
    competitors: '示例竞品 A, 示例竞品 B',
    focus: '定价、产品能力、合作与公告',
    time_range: 'week',
    frequency: 'weekly',
    run_hour: 9,
    next_run_at: '2026-09-10T01:00:00.000Z',
    last_run_at: '2026-09-03T01:00:00.000Z',
    enabled: true,
    push_email: false,
    push_webhook: false,
    webhook_type: 'generic',
    webhook_url: '',
    created_at: '2026-08-20T03:00:00.000Z',
    run_count: 3,
    last_task_id: 'demo-task-1',
    last_change_summary: '检测到定价页面更新。',
    running: true,
    running_task_id: 'demo-task-running',
    creator_nickname: '演示访客',
    can_manage: true,
  },
]

export async function demoRequest<T>(url: string, init: RequestInit): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  if (method !== 'GET') {
    throw new Error('演示模式不会保存更改')
  }

  if (url === '/api/research/quota') {
    return { plan: 'pro', plan_name: '专业版（演示）', used: 7, limit: 50, max_queries: 20, member_used: 7, member_limit: -1 } as T
  }
  if (url === '/api/notifications/unread-count') return { count: 2 } as T
  if (url === '/api/notifications') return [] as T
  if (url === '/api/intelligence/summary') {
    return {
      total: 18,
      active: 1,
      completed: 16,
      failed: 1,
      by_type: { research: 9, tracker: 6, graph: 3 },
      by_status: { queued: 0, running: 1, completed: 16, failed: 1 },
      latest_at: '2026-09-03T08:40:00.000Z',
    } as T
  }
  if (url.startsWith('/api/intelligence/events')) {
    return { items: demoEvents, total: demoEvents.length, page: 1, page_size: 12 } as T
  }
  if (url.startsWith('/api/assets')) {
    return {
      items: demoAssets,
      total: demoAssets.length,
      page: 1,
      page_size: 20,
      type_counts: { competitor: 1, profile: 0, research_task: 1, graph_project: 1 },
    } as T
  }
  if (url.startsWith('/api/trackers')) return demoTrackers as T
  if (url.startsWith('/api/competitors') || url.startsWith('/api/profiles') || url.startsWith('/api/graph') || url.startsWith('/api/research')) return [] as T

  throw new Error('此页面需要连接正式后端，演示模式暂不提供')
}

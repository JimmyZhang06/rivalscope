import type {
  AdminOrg,
  AdminOrgListResponse,
  AdminStats,
  AdminUserListResponse,
  AssistantMessage,
  AssistantSession,
  Competitor,
  CompetitorPage,
  CompetitorProfile,
  CrawlTask,
  ForgotResponse,
  GraphCreate,
  GraphDetail,
  GraphProject,
  LoginLog,
  NotificationItem,
  Order,
  Org,
  OrgMe,
  OrgMember,
  Plan,
  PlanInfo,
  GenerateTaskStatus,
  ProfileTemplate,
  Quota,
  ResearchCreate,
  Role,
  SourceDetail,
  Step,
  TaskBrief,
  TaskDetail,
  TaskStatus,
  TokenResponse,
  Tracker,
  TrackerCreate,
  TrackerRun,
  TrackerUpdate,
  UsageStats,
  User,
} from './types'

const TOKEN_KEY = 'cr_token'
const REFRESH_KEY = 'cr_refresh'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REFRESH_KEY) },
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY)
}

export function setRefreshToken(token: string) {
  localStorage.setItem(REFRESH_KEY, token)
}

let refreshPromise: Promise<void> | null = null

async function tryRefreshToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  const refresh = getRefreshToken()
  if (!refresh) return false

  refreshPromise = (async () => {
    try {
      const resp = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      })
      if (!resp.ok) { tokenStore.clear(); return false }
      const data = await resp.json() as TokenResponse
      if (data.access_token) {
        tokenStore.set(data.access_token)
        if (data.refresh_token) setRefreshToken(data.refresh_token)
        return true
      }
      return false
    } catch { return false } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  const token = tokenStore.get()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (init.body) headers['Content-Type'] = 'application/json'

  const resp = await fetch(url, { ...init, headers })
  if (resp.status === 401) {
    const refreshed = await tryRefreshToken()
    if (!refreshed) {
      tokenStore.clear()
      if (!url.startsWith('/api/auth/')) window.location.href = '/login'
      return undefined as T
    }
    // retry with new token
    const newToken = tokenStore.get()
    if (newToken) headers['Authorization'] = `Bearer ${newToken}`
    const retry = await fetch(url, { ...init, headers })
    if (retry.status === 204) return undefined as T
    if (!retry.ok) {
      const body = await retry.json().catch(() => null)
      let detail = body?.detail
      if (Array.isArray(detail)) detail = detail[0]?.msg ?? '请求参数有误'
      throw new ApiError(retry.status, detail ?? `请求失败 (${retry.status})`)
    }
    if (retry.status === 204) return undefined as T
    return retry.json()
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => null)
    let detail = body?.detail
    if (Array.isArray(detail)) detail = detail[0]?.msg ?? '请求参数有误'
    throw new ApiError(resp.status, detail ?? `请求失败 (${resp.status})`)
  }
  if (resp.status === 204) return undefined as T
  return resp.json()
}

// ---------- 认证 ----------

export function register(email: string, password: string, nickname: string): Promise<TokenResponse> {
  return request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, nickname }) })
}

export function login(email: string, password: string): Promise<TokenResponse> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export function fetchMe(): Promise<User> {
  return request('/api/auth/me')
}

// ---------- 账号管理 ----------

export function updateProfile(payload: { nickname?: string; avatar?: string }): Promise<User> {
  return request('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(payload) })
}

export function changePassword(oldPassword: string, newPassword: string): Promise<TokenResponse> {
  return request('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  })
}

export function listLogins(): Promise<LoginLog[]> {
  return request('/api/auth/logins')
}

export function logoutAll(): Promise<TokenResponse> {
  return request('/api/auth/logout-all', { method: 'POST' })
}

export function deleteAccount(password: string): Promise<{ message: string }> {
  return request('/api/auth/account', { method: 'DELETE', body: JSON.stringify({ password }) })
}

export function getUsage(): Promise<UsageStats> {
  return request('/api/auth/usage')
}

export function forgotPassword(email: string): Promise<ForgotResponse> {
  return request('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) })
}

export function resetPassword(email: string, code: string, newPassword: string): Promise<{ message: string }> {
  return request('/api/auth/reset', {
    method: 'POST',
    body: JSON.stringify({ email, code, new_password: newPassword }),
  })
}

// ---------- 调研任务 ----------

export function createResearch(payload: ResearchCreate): Promise<TaskBrief> {
  return request('/api/research', { method: 'POST', body: JSON.stringify(payload) })
}

export function listResearch(): Promise<TaskBrief[]> {
  return request('/api/research')
}

export function getResearch(id: string): Promise<TaskDetail> {
  return request(`/api/research/${id}`)
}

export function getSourceDetail(taskId: string, sourceId: number): Promise<SourceDetail> {
  return request(`/api/research/${taskId}/sources/${sourceId}`)
}

export function deleteResearch(id: string): Promise<void> {
  return request(`/api/research/${id}`, { method: 'DELETE' })
}

export function getQuota(): Promise<Quota> {
  return request('/api/research/quota')
}

/** 基于报告与来源的无状态追问（不占调研配额） */
export function askResearch(taskId: string, question: string): Promise<{ answer: string }> {
  return request(`/api/research/${taskId}/ask`, { method: 'POST', body: JSON.stringify({ question }) })
}

/** 把报告以附件邮件发送给收件人（附件由前端导出后上传，to 支持逗号分隔多个） */
export async function emailReport(
  taskId: string,
  to: string,
  file: Blob,
  filename: string,
): Promise<{ status: string; recipients: number }> {
  const form = new FormData()
  form.append('to', to)
  form.append('file', file, filename)
  const token = tokenStore.get()
  // FormData 需由浏览器自动设置 multipart 边界，不能复用统一 request（其会强制 JSON 头）
  const resp = await fetch(`/api/research/${taskId}/email`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (!resp.ok) {
    const body = await resp.json().catch(() => null)
    let detail = body?.detail
    if (Array.isArray(detail)) detail = detail[0]?.msg ?? '请求参数有误'
    throw new ApiError(resp.status, detail ?? `请求失败 (${resp.status})`)
  }
  return resp.json()
}

/** 订阅任务 SSE 进度（token 走查询参数），返回取消订阅函数 */
export function subscribeEvents(
  id: string,
  onStep: (step: Step) => void,
  onStatus: (status: TaskStatus) => void,
): () => void {
  const token = tokenStore.get() ?? ''
  const es = new EventSource(`/api/research/${id}/events?token=${encodeURIComponent(token)}`)
  es.addEventListener('step', (e) => {
    onStep(JSON.parse((e as MessageEvent).data))
  })
  es.addEventListener('status', (e) => {
    const { status } = JSON.parse((e as MessageEvent).data)
    onStatus(status)
    if (status === 'completed' || status === 'failed') es.close()
  })
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) es.close()
  }
  return () => es.close()
}

// ---------- 计费 ----------

export function listPlans(): Promise<PlanInfo[]> {
  return request('/api/billing/plans')
}

export function upgradePlan(plan: Plan): Promise<Order> {
  return request('/api/billing/upgrade', { method: 'POST', body: JSON.stringify({ plan }) })
}

export function listOrders(): Promise<Order[]> {
  return request('/api/billing/orders')
}

// ---------- 管理后台 ----------

export function adminStats(): Promise<AdminStats> {
  return request('/api/admin/stats')
}

export function adminListUsers(q = '', page = 1, pageSize = 20): Promise<AdminUserListResponse> {
  const params = new URLSearchParams({ q, page: String(page), page_size: String(pageSize) })
  return request(`/api/admin/users?${params}`)
}

export function adminUpdateUser(id: string, payload: { plan?: Plan; role?: Role }): Promise<User> {
  return request(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function adminListOrgs(q = '', page = 1, pageSize = 20): Promise<AdminOrgListResponse> {
  const params = new URLSearchParams({ q, page: String(page), page_size: String(pageSize) })
  return request(`/api/admin/orgs?${params}`)
}

export function adminUpdateOrg(id: string, payload: { plan?: Plan }): Promise<AdminOrg> {
  return request(`/api/admin/orgs/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

// ---------- 企业组织 ----------

export function createOrg(name: string): Promise<Org> {
  return request('/api/org', { method: 'POST', body: JSON.stringify({ name }) })
}

export function getOrgMe(): Promise<OrgMe> {
  return request('/api/org/me')
}

export function updateOrg(name: string): Promise<Org> {
  return request('/api/org', { method: 'PATCH', body: JSON.stringify({ name }) })
}

export function resetInviteCode(): Promise<Org> {
  return request('/api/org/invite-code/reset', { method: 'POST' })
}

export function joinOrg(inviteCode: string): Promise<Org> {
  return request('/api/org/join', { method: 'POST', body: JSON.stringify({ invite_code: inviteCode }) })
}

export function listOrgMembers(): Promise<OrgMember[]> {
  return request('/api/org/members')
}

export function updateOrgMember(
  id: string,
  patch: { org_role?: 'admin' | 'member'; org_monthly_limit?: number },
): Promise<OrgMember> {
  return request(`/api/org/members/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function removeOrgMember(id: string): Promise<void> {
  return request(`/api/org/members/${id}`, { method: 'DELETE' })
}

export function leaveOrg(): Promise<void> {
  return request('/api/org/leave', { method: 'POST' })
}

// ---------- 定时追踪 ----------

export function createTracker(payload: TrackerCreate): Promise<Tracker> {
  return request('/api/trackers', { method: 'POST', body: JSON.stringify(payload) })
}

export function listTrackers(): Promise<Tracker[]> {
  return request('/api/trackers')
}

// ---------- 竞品管理 ----------

export function listCompetitors(): Promise<Competitor[]> {
  return request('/api/competitors')
}

export function createCompetitor(payload: Omit<Competitor, 'id' | 'created_at' | 'updated_at'>): Promise<Competitor> {
  return request('/api/competitors', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateCompetitor(id: string, payload: Omit<Competitor, 'id' | 'created_at' | 'updated_at'>): Promise<Competitor> {
  return request(`/api/competitors/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function deleteCompetitor(id: string): Promise<void> {
  return request(`/api/competitors/${id}`, { method: 'DELETE' })
}

// ---------- 画像模板 ----------

export function listProfileTemplates(): Promise<ProfileTemplate[]> {
  return request('/api/profiles/templates')
}

export function createProfileTemplate(payload: { name: string; dimensions: any[]; org_id: string }): Promise<ProfileTemplate> {
  return request('/api/profiles/templates', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateProfileTemplate(id: string, payload: { name: string; dimensions: any[]; org_id: string }): Promise<ProfileTemplate> {
  return request(`/api/profiles/templates/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function freezeProfileTemplate(id: string): Promise<{ id: string; frozen_at: string | null }> {
  return request(`/api/profiles/templates/${id}/freeze`, { method: 'POST' })
}

export function deleteProfileTemplate(id: string): Promise<void> {
  return request(`/api/profiles/templates/${id}`, { method: 'DELETE' })
}

// ---------- 画像 ----------

export function generateProfileApi(payload: { competitor_id: string; template_id: string }): Promise<any> {
  return request('/api/profiles/generate', { method: 'POST', body: JSON.stringify(payload) })
}

export function generateProfileFromCrawl(payload: { competitor_id: string; template_id: string }): Promise<{ task_id: string; status: string }> {
  return request('/api/profiles/generate-from-crawl', { method: 'POST', body: JSON.stringify(payload) })
}

export function getGenerateStatus(taskId: string): Promise<GenerateTaskStatus> {
  return request(`/api/profiles/generate-from-crawl/${taskId}`)
}

export function listProfiles(): Promise<CompetitorProfile[]> {
  return request('/api/profiles')
}

export function listProfileExtractTasks(): Promise<Array<{
  task_id: string
  competitor_id: string
  template_id: string
  status: string
  current_step: string
  error: string
  created_at: string | null
  updated_at: string | null
}>> {
  return request('/api/profiles/tasks')
}

export function freezeProfileApi(id: string): Promise<{ id: string; status: string }> {
  return request(`/api/profiles/${id}/freeze`, { method: 'POST' })
}

// ---------- 横向对比 ----------

export function compareProfiles(payload: { template_id: string; competitor_ids: string[] }): Promise<any> {
  return request('/api/profiles/compare', { method: 'POST', body: JSON.stringify(payload) })
}

// ---------- RBAC 权限 ----------

export function getMyPermissions(): Promise<{ permissions: string[] }> {
  return request('/api/me/permissions')
}

export function setMemberPermissions(memberId: string, permissions: string[]): Promise<OrgMember> {
  return request(`/api/org/members/${memberId}/permissions`, { method: 'POST', body: JSON.stringify({ permissions }) })
}

// ---------- 审计日志 ----------

export function listAuditLogs(params?: {
  action?: string
  resource_type?: string
  user_id?: string
  start?: string
  end?: string
  page?: number
  page_size?: number
}): Promise<AdminUserListResponse> {
  const p = new URLSearchParams()
  if (params?.action) p.set('action', params.action)
  if (params?.resource_type) p.set('resource_type', params.resource_type)
  if (params?.user_id) p.set('user_id', params.user_id)
  if (params?.start) p.set('start', params.start)
  if (params?.end) p.set('end', params.end)
  p.set('page', String(params?.page ?? 1))
  p.set('page_size', String(params?.page_size ?? 20))
  const qs = p.toString()
  return request(`/api/admin/audit-logs?${qs}`)
}

// ---------- 执行快照 ----------

export function listExecutionSnapshots(taskId?: string): Promise<any[]> {
  const url = taskId ? `/api/admin/execution-snapshots?task_id=${taskId}` : '/api/admin/execution-snapshots'
  return request(url)
}

export function getTracker(id: string): Promise<Tracker> {
  return request(`/api/trackers/${id}`)
}

export function updateTracker(id: string, payload: TrackerUpdate): Promise<Tracker> {
  return request(`/api/trackers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export function deleteTracker(id: string): Promise<void> {
  return request(`/api/trackers/${id}`, { method: 'DELETE' })
}

export function runTrackerNow(id: string): Promise<TrackerRun> {
  return request(`/api/trackers/${id}/run-now`, { method: 'POST' })
}

export function listTrackerRuns(id: string): Promise<TrackerRun[]> {
  return request(`/api/trackers/${id}/runs`)
}

// ---------- 产业链关系图谱 ----------

export function createGraph(payload: GraphCreate): Promise<GraphProject> {
  return request('/api/graph', { method: 'POST', body: JSON.stringify(payload) })
}

export function listGraphs(): Promise<GraphProject[]> {
  return request('/api/graph')
}

export function getGraph(id: string): Promise<GraphDetail> {
  return request(`/api/graph/${id}`)
}

export function refreshGraph(id: string): Promise<GraphProject> {
  return request(`/api/graph/${id}/refresh`, { method: 'POST' })
}

export function deleteGraph(id: string): Promise<void> {
  return request(`/api/graph/${id}`, { method: 'DELETE' })
}

// ---------- 站内通知 ----------

export function listNotifications(): Promise<NotificationItem[]> {
  return request('/api/notifications')
}

export function getUnreadCount(): Promise<{ count: number }> {
  return request('/api/notifications/unread-count')
}

/** 标记已读：传 id 标记单条，不传标记全部 */
export function markNotificationsRead(id = ''): Promise<void> {
  return request('/api/notifications/read', { method: 'POST', body: JSON.stringify({ id }) })
}

// ---------- 全局 AI 助手 ----------

/** 会话列表（最近活跃优先）；首次访问会把旧消息归入「历史对话」 */
export function listAssistantSessions(): Promise<AssistantSession[]> {
  return request('/api/assistant/sessions')
}

export function renameAssistantSession(sessionId: string, title: string): Promise<AssistantSession> {
  return request(`/api/assistant/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

export function deleteAssistantSession(sessionId: string): Promise<void> {
  return request(`/api/assistant/sessions/${sessionId}`, { method: 'DELETE' })
}

/** 某个会话的消息历史（升序） */
export function listSessionMessages(sessionId: string): Promise<AssistantMessage[]> {
  return request(`/api/assistant/sessions/${sessionId}/messages`)
}

/** 清空某个会话的消息（保留会话本身） */
export function clearSessionMessages(sessionId: string): Promise<void> {
  return request(`/api/assistant/sessions/${sessionId}/messages`, { method: 'DELETE' })
}

/** 跨报告问答（不占调研配额）；sessionId 为空则后端新建会话，返回落库后的 AI 回复 */
export function askAssistant(question: string, sessionId = ''): Promise<AssistantMessage> {
  return request('/api/assistant/ask', {
    method: 'POST',
    body: JSON.stringify({ question, session_id: sessionId }),
  })
}

// ---------- 竞品爬取 ----------

export function startCrawl(competitorId: string, maxPages = 50): Promise<{ task_id: string; competitor_id: string; status: string }> {
  return request(`/api/competitors/${competitorId}/crawl`, {
    method: 'POST',
    body: JSON.stringify({ max_pages: maxPages }),
  })
}

export function getCrawlStatus(competitorId: string): Promise<CrawlTask> {
  return request(`/api/competitors/${competitorId}/crawl/status`)
}

export function listCrawlPages(competitorId: string): Promise<CompetitorPage[]> {
  return request(`/api/competitors/${competitorId}/pages`)
}

import type {
  AdminOrg,
  AdminOrgListResponse,
  AdminStats,
  AdminUserListResponse,
  AuditLogListResponse,
  AssistantMessage,
  AssistantSession,
  Competitor,
  CompetitorPage,
  CompetitorProfile,
  ComparisonResponse,
  CrawlTask,
  ForgotResponse,
  GraphCreate,
  GraphDetail,
  GraphProject,
  InsightsData,
  IntelligenceEventList,
  IntelligenceEventStatus,
  IntelligenceEventSummary,
  IntelligenceEventType,
  IntelligenceObjectListResponse,
  IntelligenceObjectType,
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
import { demoRequest, isDemoMode } from './demo'

const TOKEN_KEY = 'cr_token'
const REFRESH_KEY = 'cr_refresh'
const CR_TOKEN_IAT = 'cr_token_iat'

// Token proactive refresh constants
const ACCESS_TOKEN_TTL_MS = 8 * 60 * 60 * 1000   // 8 hours
const REFRESH_THRESHOLD_MS = 1 * 60 * 60 * 1000  // refresh 1 hour before expiry

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    sessionStorage.removeItem(CR_TOKEN_IAT)
    ;['task-store', 'competitor-store', 'profile-store', 'graph-store', 'tracker-store']
      .forEach((key) => localStorage.removeItem(key))
    window.dispatchEvent(new Event('auth-session-cleared'))
  },
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY)
}

export function setRefreshToken(token: string) {
  localStorage.setItem(REFRESH_KEY, token)
}

function getTokenIssuedAt(): number {
  const v = sessionStorage.getItem(CR_TOKEN_IAT)
  return v ? Number(v) : 0
}

function setTokenIssuedAt(ts: number) {
  sessionStorage.setItem(CR_TOKEN_IAT, String(ts))
}

function shouldProactiveRefresh(): boolean {
  const issued = getTokenIssuedAt()
  if (!issued) return false
  const age = Date.now() - issued
  return age > (ACCESS_TOKEN_TTL_MS - REFRESH_THRESHOLD_MS)
}

let refreshPromise: Promise<boolean> | null = null

export async function tryProactiveRefresh(): Promise<boolean> {
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
        saveTokens(data)
        return true
      }
      return false
    } catch { return false }
  })()

  try {
    return await refreshPromise
  } finally {
    // Delay cleanup to allow other concurrent callers to reuse the same promise
    setTimeout(() => { refreshPromise = null }, 0)
  }
}

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
        saveTokens(data)
        return true
      }
      return false
    } catch { return false }
  })()

  try {
    return await refreshPromise
  } finally {
    setTimeout(() => { refreshPromise = null }, 0)
  }
}

function maybeProactiveRefresh(): void {
  if (shouldProactiveRefresh()) {
    tryProactiveRefresh().catch(() => {})
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  if (isDemoMode()) return demoRequest<T>(url, init)

  // Proactive token refresh check before each request
  maybeProactiveRefresh()

  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  const token = tokenStore.get()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (init.body) headers['Content-Type'] = 'application/json'

  const resp = await fetch(url, { ...init, headers })
  const isAuthEndpoint = url.startsWith('/api/auth/')

  if (resp.status === 401) {
    // 匿名认证请求不存在可刷新的有效会话，应直接呈现后端错误。
    // 否则 undefined 会继续流入 saveTokens，向用户暴露运行时异常。
    const anonymousAuthEndpoints = [
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/forgot',
      '/api/auth/reset',
      '/api/auth/refresh',
    ]
    if (anonymousAuthEndpoints.includes(url)) {
      const body = await resp.json().catch(() => null)
      let detail = body?.detail
      if (Array.isArray(detail)) detail = detail[0]?.msg ?? '请求参数有误'
      throw new ApiError(resp.status, detail ?? '认证失败')
    }

    const refreshed = await tryRefreshToken()

    if (!refreshed) {
      tokenStore.clear()
      // Only redirect for non-auth endpoints (avoid loop when refresh itself returns 401)
      if (!isAuthEndpoint && !url.includes('/api/auth/refresh')) {
        window.location.href = '/login'
      }
      const body = await resp.json().catch(() => null)
      let detail = body?.detail
      if (Array.isArray(detail)) detail = detail[0]?.msg ?? '请求参数有误'
      throw new ApiError(resp.status, detail ?? '登录状态已失效，请重新登录')
    }

    // Refresh succeeded, retry with new token
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

async function collectAllPages<T>(fetchPage: (page: number, pageSize: number) => Promise<T[]>): Promise<T[]> {
  const pageSize = 100
  const items: T[] = []
  for (let page = 1; page <= 100; page += 1) {
    const chunk = await fetchPage(page, pageSize)
    items.push(...chunk)
    if (chunk.length < pageSize) break
  }
  return items
}

async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = () => {
    const headers = new Headers(init.headers)
    const token = tokenStore.get()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(url, { ...init, headers })
  }
  let response = await send()
  if (response.status === 401 && await tryRefreshToken()) response = await send()
  return response
}

// ---------- 认证 ----------

export function login(email: string, password: string): Promise<TokenResponse> {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export function register(email: string, password: string, nickname: string): Promise<TokenResponse> {
  return request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, nickname }) })
}

export async function saveTokens(data: TokenResponse) {
  tokenStore.set(data.access_token)
  if (data.refresh_token) setRefreshToken(data.refresh_token)
  // Record token issuance time for proactive refresh logic
  setTokenIssuedAt(Date.now())
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

export function listResearch(page?: number, pageSize = 20): Promise<TaskBrief[]> {
  const fetchPage = (currentPage: number, currentSize: number) => {
    const params = new URLSearchParams({ page: String(currentPage), page_size: String(currentSize) })
    return request<TaskBrief[]>('/api/research?' + params)
  }
  return page === undefined ? collectAllPages(fetchPage) : fetchPage(page, pageSize)
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

// ---------- 统一情报资产 ----------

export function listAssets(params: {
  page?: number
  pageSize?: number
  types?: IntelligenceObjectType[]
  query?: string
  status?: string
} = {}): Promise<IntelligenceObjectListResponse> {
  const search = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 20),
  })
  params.types?.forEach((type) => search.append('types', type))
  if (params.query?.trim()) search.set('q', params.query.trim())
  if (params.status) search.set('status', params.status)
  return request('/api/assets?' + search)
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
  // FormData 需由浏览器自动设置 multipart 边界，不能复用统一 request（其会强制 JSON 头）
  const resp = await authorizedFetch(`/api/research/${taskId}/email`, {
    method: 'POST',
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

/** 订阅任务 SSE 进度；URL 仅携带 60 秒、任务绑定的 stream ticket。 */
export function subscribeEvents(
  id: string,
  onStep: (step: Step) => void,
  onStatus: (status: TaskStatus) => void,
  onError?: (message: string) => void,
): () => void {
  let es: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let cancelled = false
  const MAX_RECONNECT = 5

  function scheduleReconnect() {
    es?.close()
    if (cancelled || reconnectTimer) return
    if (reconnectAttempts >= MAX_RECONNECT) {
      onError?.('实时进度连接已中断，已切换为定时刷新')
      return
    }
    reconnectAttempts += 1
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect().catch(scheduleReconnect)
    }, delay)
  }

  async function connect() {
    const { ticket } = await request<{ ticket: string; expires_in: number }>(
      `/api/research/${id}/events/ticket`,
      { method: 'POST' },
    )
    if (cancelled) return
    es = new EventSource(`/api/research/${id}/events?ticket=${encodeURIComponent(ticket)}`)

    es.addEventListener('step', (e) => {
      onStep(JSON.parse((e as MessageEvent).data))
      reconnectAttempts = 0 // received data means connection is healthy
    })

    es.addEventListener('status', (e) => {
      const { status } = JSON.parse((e as MessageEvent).data)
      onStatus(status)
      if (status === 'completed' || status === 'failed') {
        es?.close()
      }
    })

    es.onerror = () => {
      scheduleReconnect()
    }
  }

  connect().catch(scheduleReconnect)

  return () => {
    cancelled = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    es?.close()
  }
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

export function listTrackers(page?: number, pageSize = 20): Promise<Tracker[]> {
  const fetchPage = (currentPage: number, currentSize: number) => {
    const params = new URLSearchParams({ page: String(currentPage), page_size: String(currentSize) })
    return request<Tracker[]>('/api/trackers?' + params)
  }
  return page === undefined ? collectAllPages(fetchPage) : fetchPage(page, pageSize)
}

// ---------- 竞品管理 ----------

export function listCompetitors(page?: number, pageSize = 50): Promise<Competitor[]> {
  const fetchPage = (currentPage: number, currentSize: number) => {
    const params = new URLSearchParams({ page: String(currentPage), page_size: String(currentSize) })
    return request<Competitor[]>('/api/competitors?' + params)
  }
  return page === undefined ? collectAllPages(fetchPage) : fetchPage(page, pageSize)
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

export function listProfileTemplates(page?: number, pageSize = 50): Promise<ProfileTemplate[]> {
  const fetchPage = (currentPage: number, currentSize: number) => {
    const params = new URLSearchParams({ page: String(currentPage), page_size: String(currentSize) })
    return request<ProfileTemplate[]>('/api/profiles/templates?' + params)
  }
  return page === undefined ? collectAllPages(fetchPage) : fetchPage(page, pageSize)
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
  return request(`/api/profiles/generate/${taskId}`)
}

export function getProfile(id: string): Promise<CompetitorProfile> {
  return request(`/api/profiles/${id}`)
}

export function listProfiles(page?: number, pageSize = 20): Promise<CompetitorProfile[]> {
  const fetchPage = (currentPage: number, currentSize: number) => {
    const params = new URLSearchParams({ page: String(currentPage), page_size: String(currentSize) })
    return request<CompetitorProfile[]>('/api/profiles?' + params)
  }
  return page === undefined ? collectAllPages(fetchPage) : fetchPage(page, pageSize)
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

// ---------- 画像报告与洞察 ----------

export function getProfileReport(id: string): Promise<{ report_markdown: string; insights: any; source_index: any[]; quality: any }> {
  return request(`/api/profiles/${id}/report`)
}

export function getProfileInsights(id: string): Promise<InsightsData> {
  return request(`/api/profiles/${id}/insights`)
}

/** One-call: fetch report + insights + source_index together (faster than two separate calls) */
export function getProfileFullReport(id: string): Promise<{ report_markdown: string; insights: any; source_index: any[]; quality: any }> {
  return request(`/api/profiles/${id}/report-full`)
}

// ---------- 横向对比 ----------

export function compareProfiles(payload: { template_id: string; profile_ids: string[] }): Promise<ComparisonResponse> {
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
}): Promise<AuditLogListResponse> {
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

export async function exportAuditLogs(params?: {
  action?: string
  resource_type?: string
  user_id?: string
  start?: string
  end?: string
}): Promise<Blob> {
  const p = new URLSearchParams()
  if (params?.action) p.set('action', params.action)
  if (params?.resource_type) p.set('resource_type', params.resource_type)
  if (params?.user_id) p.set('user_id', params.user_id)
  if (params?.start) p.set('start', params.start)
  if (params?.end) p.set('end', params.end)
  const qs = p.toString()
  const response = await authorizedFetch(`/api/admin/audit-logs/export?${qs}`)
  if (!response.ok) throw new ApiError(response.status, '导出失败')
  return response.blob()
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

export function listGraphs(page?: number, pageSize = 20): Promise<GraphProject[]> {
  const fetchPage = (currentPage: number, currentSize: number) => {
    const params = new URLSearchParams({ page: String(currentPage), page_size: String(currentSize) })
    return request<GraphProject[]>('/api/graph?' + params)
  }
  return page === undefined ? collectAllPages(fetchPage) : fetchPage(page, pageSize)
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

// ---------- 事件流与监测中心 ----------

export function listIntelligenceEvents(params?: {
  eventType?: 'all' | IntelligenceEventType
  status?: 'all' | IntelligenceEventStatus
  page?: number
  pageSize?: number
}): Promise<IntelligenceEventList> {
  const query = new URLSearchParams({
    event_type: params?.eventType ?? 'all',
    status: params?.status ?? 'all',
    page: String(params?.page ?? 1),
    page_size: String(params?.pageSize ?? 30),
  })
  return request(`/api/intelligence/events?${query}`)
}

export function getIntelligenceEventSummary(): Promise<IntelligenceEventSummary> {
  return request('/api/intelligence/summary')
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

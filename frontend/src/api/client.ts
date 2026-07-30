import type {
  AdminStats,
  ForgotResponse,
  LoginLog,
  Order,
  Plan,
  PlanInfo,
  Quota,
  ResearchCreate,
  Role,
  SourceDetail,
  Step,
  TaskBrief,
  TaskDetail,
  TaskStatus,
  TokenResponse,
  UsageStats,
  User,
} from './types'

const TOKEN_KEY = 'cr_token'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  const token = tokenStore.get()
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (init.body) headers['Content-Type'] = 'application/json'

  const resp = await fetch(url, { ...init, headers })
  if (resp.status === 401) {
    tokenStore.clear()
    // 会话失效，回到登录页（登录/注册接口本身除外）
    if (!url.startsWith('/api/auth/')) window.location.href = '/login'
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

export function adminListUsers(q = ''): Promise<User[]> {
  return request(`/api/admin/users?q=${encodeURIComponent(q)}`)
}

export function adminUpdateUser(id: string, payload: { plan?: Plan; role?: Role }): Promise<User> {
  return request(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

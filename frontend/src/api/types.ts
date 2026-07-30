export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'searching'
  | 'analyzing'
  | 'reporting'
  | 'completed'
  | 'failed'

export interface TaskBrief {
  id: string
  product_name: string
  competitors: string
  focus: string
  status: TaskStatus
  error: string
  created_at: string
  updated_at: string
}

export interface Step {
  id: string
  seq: number
  phase: string
  title: string
  detail: string
  created_at: string
}

export type SourceTier = 'official' | 'media' | 'community' | 'other'

export interface Source {
  id: number
  title: string
  url: string
  snippet: string
  score: number
  domain: string
  tier: SourceTier
  published_at: string
  dimension: string
}

export interface SourceDetail extends Source {
  raw_content: string
}

export interface CompetitorScore {
  name: string
  scores: Record<string, number>
  positioning: string
}

export interface ReportData {
  dimensions: string[]
  competitors: CompetitorScore[]
  swot: {
    strengths: string[]
    weaknesses: string[]
    opportunities: string[]
    threats: string[]
  }
  verdict: string
}

export interface TaskDetail extends TaskBrief {
  report_markdown: string
  report_data: ReportData | null
  steps: Step[]
  sources: Source[]
}

export interface ResearchCreate {
  product_name: string
  competitors: string
  focus: string
}

// ---------- 账号体系 ----------

export type Role = 'user' | 'admin'
export type Plan = 'free' | 'pro' | 'enterprise'

export interface User {
  id: string
  email: string
  nickname: string
  avatar: string
  role: Role
  plan: Plan
  plan_expires_at: string | null
  created_at: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  user: User
}

export interface Quota {
  plan: Plan
  plan_name: string
  used: number
  limit: number // -1 表示不限
  max_queries: number
}

export interface PlanInfo {
  key: Plan
  name: string
  price: number
  monthly_tasks: number
  max_queries: number
  priority: boolean
  description: string
}

export interface Order {
  id: string
  plan: Plan
  amount: number
  status: string
  created_at: string
  paid_at: string | null
}

export interface AdminStats {
  total_users: number
  total_tasks: number
  tasks_this_month: number
  total_revenue: number
  paid_users: number
}

export interface LoginLog {
  id: string
  action: 'login' | 'register' | 'reset'
  ip: string
  user_agent: string
  created_at: string
}

export interface MonthUsage {
  month: string // YYYY-MM
  count: number
}

export interface UsageStats {
  months: MonthUsage[]
  quota: Quota
}

export interface ForgotResponse {
  message: string
  demo_code: string
}

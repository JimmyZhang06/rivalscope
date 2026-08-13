export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'searching'
  | 'analyzing'
  | 'reporting'
  | 'completed'
  | 'failed'

// 检索时效：''=不限 / day=近1天 / week=近1周 / month=近1月 / year=近1年
export type TimeRange = '' | 'day' | 'week' | 'month' | 'year'

export interface TaskBrief {
  id: string
  product_name: string
  competitors: string
  focus: string
  status: TaskStatus
  error: string
  org_id: string
  tracker_id: string
  creator_nickname: string
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
  age_days: number // 距今天数，无日期为 -1
  confidence: number // 0~1，来源可信度评分
  conflict_status: string // none / pending
  is_duplicate: boolean
  access_status: string // '' / success / failed
}

export interface SourceDetail extends Source {
  raw_content: string
}

export interface CompetitorScore {
  name: string
  scores: Record<string, number>
  positioning: string
}

export interface TimelineEvent {
  date: string // YYYY-MM-DD 或 YYYY-MM
  title: string
  summary: string
  ref: number | null // 对应来源编号 [n]，可能为空
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
  timeline?: TimelineEvent[] // 事件时间线（可能缺失，前端优雅降级）
}

export interface TaskDetail extends TaskBrief {
  report_markdown: string
  report_data: ReportData | null
  change_summary: string
  steps: Step[]
  sources: Source[]
}

export interface ResearchCreate {
  product_name: string
  competitors: string
  focus: string
  time_range: TimeRange
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

export interface Competitor {
  id: string
  org_id: string
  name: string
  alias: string
  website: string
  tech_focus: string
  keywords: string[]
  status: 'active' | 'paused' | 'archived'
  created_at: string
  updated_at: string
  crawl_status: string // idle / running / done / error
  last_crawled_at: string | null
  crawl_error: string
}

export type CrawlTaskStatus = 'pending' | 'running' | 'done' | 'error'

export interface CrawlTask {
  id: string
  competitor_id: string
  org_id: string
  user_id: string
  status: CrawlTaskStatus
  total_pages: number
  crawled_pages: number
  error: string
  crawl_config: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface CompetitorPage {
  id: string
  competitor_id: string
  url: string
  page_type: string
  title: string
  access_status: string
  access_error: string
  discovered_at: string
  crawled_at: string | null
}

export interface ProfileTemplate {
  id: string
  org_id: string
  name: string
  dimensions: Array<{ key: string; label: string; fields: Array<{ key: string; label: string; type: string }> }>
  version: number
  frozen_at: string | null
  created_by: string
  created_at: string
}

export interface CompetitorProfile {
  id: string
  org_id: string
  competitor_id: string
  template_id: string
  template_version: number
  profile_data: Record<string, any>
  source_refs: Array<{ url: string; title: string; snippet: string }>
  status: 'draft' | 'reviewed' | 'frozen'
  frozen_at: string | null
  generation_source: string
  report_markdown: string
  insights_json: string
  source_index_json: string
  created_at: string
  updated_at: string
}

// 洞察数据（补充 dimension_labels）
export interface InsightsData {
  scores: Record<string, number>
  dimension_labels?: Record<string, string>  // { "product_overview": "产品概况" }
  verdict: string
  positioning: string
  swot: {
    strengths: string[]
    weaknesses: string[]
    opportunities: string[]
    threats: string[]
  }
  timeline: Array<{ date: string; title: string; summary: string }>
}

export interface GenerateTaskStatus {
  task_id: string
  competitor_id: string
  template_id: string
  status: string
  current_step: string
  error: string
  created_at: string | null
  updated_at: string | null
  result?: any
}

export type ProfileTaskStatus = 'pending' | 'running' | 'done' | 'error'

export interface TokenResponse {
  access_token: string
  token_type: string
  refresh_token: string
  user: User
}

export interface Quota {
  plan: Plan
  plan_name: string
  used: number
  limit: number // -1 表示不限
  max_queries: number
  member_used: number // 本月本人发起次数（企业成员维度）
  member_limit: number // 管理员设置的成员月额度，-1 未设限
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

export interface AdminUserListResponse {
  items: User[]
  total: number
  page: number
  page_size: number
}

export interface AdminOrgListResponse {
  items: AdminOrg[]
  total: number
  page: number
  page_size: number
}

export interface AdminOrg {
  id: string
  name: string
  plan: Plan
  plan_expires_at: string | null
  invite_code: string
  created_at: string
  member_count: number
  month_used: number // 本月已消耗额度（调研 + 图谱，失败不计）
}

export interface LoginLog {
  id: string
  action: 'login' | 'register' | 'reset'
  ip: string
  user_agent: string
  created_at: string
}

export interface MemberUsage {
  user_id: string
  nickname: string
  count: number
}

export interface MonthUsage {
  month: string // YYYY-MM
  count: number
}

export interface UsageStats {
  months: MonthUsage[]
  quota: Quota
  members: MemberUsage[] | null // 企业成员各自当月用量
}

export interface ForgotResponse {
  message: string
}

// ---------- 企业组织 ----------

export type OrgRole = 'owner' | 'admin' | 'member' | ''

export interface Org {
  id: string
  name: string
  plan: Plan
  plan_expires_at: string | null
  owner_id: string
  invite_code: string
  created_at: string
}

export interface OrgMe {
  org: Org | null
  org_role: OrgRole
  member_count: number
}

export interface OrgMember {
  id: string
  email: string
  nickname: string
  avatar: string
  org_role: OrgRole
  org_monthly_limit: number // -1 不限，0 禁止发起
  month_used: number // 本月本人发起的调研次数
  created_at: string
}

// ---------- 定时追踪 ----------

export type Frequency = 'daily' | 'weekly' | 'monthly'
export type WebhookType = 'wecom' | 'dingtalk' | 'feishu' | 'generic'

export interface Tracker {
  id: string
  org_id: string
  creator_id: string
  product_name: string
  competitors: string
  focus: string
  time_range: TimeRange
  frequency: Frequency
  run_hour: number
  next_run_at: string | null
  last_run_at: string | null
  enabled: boolean
  push_email: boolean
  push_webhook: boolean
  webhook_type: WebhookType
  webhook_url: string
  created_at: string
  run_count: number
  last_task_id: string
  last_change_summary: string
  running: boolean
  running_task_id: string
  creator_nickname: string // 创建人昵称
  can_manage: boolean // 当前用户是否可管理（创建人或企业管理员）
}

export interface TrackerCreate {
  product_name: string
  competitors: string
  focus: string
  time_range: TimeRange
  frequency: Frequency
  run_hour: number
  push_email: boolean
  push_webhook: boolean
  webhook_type: WebhookType
  webhook_url: string
}

export type TrackerUpdate = Partial<TrackerCreate> & { enabled?: boolean }

export interface TrackerRun {
  id: string
  status: TaskStatus
  error: string
  change_summary: string
  report_data: ReportData | null
  created_at: string
}

// ---------- 产业链关系图谱 ----------

export type GraphStatus = 'pending' | 'building' | 'completed' | 'failed'
export type EntityType = 'company' | 'product' | 'org' | 'person'
export type RelationType =
  | 'upstream_supplier'
  | 'downstream_customer'
  | 'competitor'
  | 'partner'
  | 'investor'
  | 'parent'
  | 'subsidiary'

export interface GraphProject {
  id: string
  root_name: string
  industry: string
  time_range: TimeRange
  status: GraphStatus
  error: string
  org_id: string
  created_at: string
  updated_at: string
}

export interface GraphEntity {
  id: string
  name: string
  type: EntityType
  industry: string
  description: string
  is_root: boolean
}

export interface GraphRelation {
  id: string
  source_id: string
  target_id: string
  relation_type: RelationType
  description: string
  confidence: number
  source_url: string
}

export interface GraphDetail extends GraphProject {
  report_markdown: string
  entities: GraphEntity[]
  relations: GraphRelation[]
}

export interface GraphCreate {
  root_name: string
  industry: string
  competitors: string
  time_range: TimeRange
}

// ---------- 站内通知 ----------

export interface NotificationItem {
  id: string
  title: string
  body: string
  link: string
  read: boolean
  created_at: string
}

// ---------- 全局 AI 助手 ----------

export interface AssistantRef {
  task_id: string
  product_name: string
}

export interface AssistantMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  refs: AssistantRef[] // 回答引用的报告，用户消息为空数组
}

export interface AssistantSession {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface UserPermission {
  id: string
  user_id: string
  permissions: string[]
  created_at: string
}

export interface AuditLog {
  id: string
  user_id: string
  org_id: string
  action: string
  resource_type: string
  resource_id: string
  input: string
  result: string
  status: string
  error: string
  model_name: string
  tokens_prompt: number
  tokens_completion: number
  cost: number
  ip: string
  user_agent: string
  created_at: string
}

export interface ComparisonMatrixRow {
  dimension: string
  values: Record<string, string>
}

export interface ComparisonResponse {
  template_name: string
  dimensions: string[]
  matrix: ComparisonMatrixRow[]
  source_refs: Array<Array<Record<string, unknown>>>
}

export interface AuditLogListResponse {
  items: AuditLog[]
  total: number
  page: number
  page_size: number
}

export interface ExecutionSnapshot {
  id: string
  org_id: string
  tracker_id: string
  task_id: string
  config_hash: string
  model_params: string
  kb_version: string
  deployment_env: string
  candidate_version: string
  build_hash: string
  created_by: string
  created_at: string
}

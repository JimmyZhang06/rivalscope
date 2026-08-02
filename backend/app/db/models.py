import random
import string
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, event
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _invite_code() -> str:
    """随机 8 位邀请码（大写字母+数字，排除易混淆字符）"""
    alphabet = "".join(c for c in string.ascii_uppercase + string.digits if c not in "0O1IL")
    return "".join(random.choices(alphabet, k=8))


class User(Base):
    """用户账号：role 区分普通用户/管理员，plan 为会员等级"""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(128))
    nickname: Mapped[str] = mapped_column(String(50), default="")
    avatar: Mapped[str] = mapped_column(Text, default="")  # 预设头像色键或 data:image/ 头像（base64）
    role: Mapped[str] = mapped_column(String(10), default="user")  # user / admin
    plan: Mapped[str] = mapped_column(String(20), default="free")  # free / pro / enterprise
    plan_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    token_version: Mapped[int] = mapped_column(default=0)  # 修改密码/退出所有设备时 +1，旧 token 失效
    reset_code: Mapped[str] = mapped_column(String(10), default="")  # 忘记密码验证码（演示用）
    reset_code_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    org_id: Mapped[str] = mapped_column(String(32), default="", index=True)  # 所属企业，一人一企，空串表示无
    org_role: Mapped[str] = mapped_column(String(10), default="")  # owner / admin / member，空串表示无企业
    org_monthly_limit: Mapped[int] = mapped_column(default=-1)  # 企业管理员设置的成员月调研额度，-1 不限
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    tasks: Mapped[list["ResearchTask"]] = relationship(back_populates="user")
    orders: Mapped[list["Order"]] = relationship(back_populates="user", order_by="Order.created_at.desc()")
    login_logs: Mapped[list["LoginLog"]] = relationship(
        back_populates="user", order_by="LoginLog.created_at.desc()"
    )


class Competitor(Base):
    """竞品：结构化注册竞品信息，企业维度隔离"""

    __tablename__ = "competitors"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    # 空 org_id 表示系统级模板竞品（仅管理员创建）
    name: Mapped[str] = mapped_column(String(200))
    alias: Mapped[str] = mapped_column(String(500), default="")
    website: Mapped[str] = mapped_column(String(500), default="")
    tech_focus: Mapped[str] = mapped_column(Text, default="")
    keywords: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="active")
    crawl_config: Mapped[str] = mapped_column(Text, default="")
    crawl_status: Mapped[str] = mapped_column(String(20), default="")
    crawl_error: Mapped[str] = mapped_column(Text, default="")
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class CompetitorPage(Base):
    """竞品网站爬取页面：存储从竞品官网爬取到的单页内容"""

    __tablename__ = "competitor_pages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    competitor_id: Mapped[str] = mapped_column(String(32), index=True)
    url: Mapped[str] = mapped_column(String(1000))
    page_type: Mapped[str] = mapped_column(String(50), default="other")
    # sitemap / pricing / features / product / about / docs / blog / other
    title: Mapped[str] = mapped_column(String(500), default="")
    content_text: Mapped[str] = mapped_column(Text, default="")
    # readability 提取的正文
    content_html: Mapped[str] = mapped_column(Text, default="")
    # 原始 HTML（截断）

    access_status: Mapped[str] = mapped_column(String(20), default="")
    # success / failed / skipped
    access_error: Mapped[str] = mapped_column(Text, default="")

    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CrawlTask(Base):
    """竞品爬取任务：跟踪一次全站爬取的进度"""

    __tablename__ = "crawl_tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    competitor_id: Mapped[str] = mapped_column(String(32), index=True)
    org_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    user_id: Mapped[str] = mapped_column(String(32), index=True)

    status: Mapped[str] = mapped_column(String(20), default="pending")
    # pending / running / done / error
    total_pages: Mapped[int] = mapped_column(default=0)
    crawled_pages: Mapped[int] = mapped_column(default=0)
    error: Mapped[str] = mapped_column(Text, default="")

    crawl_config: Mapped[str] = mapped_column(Text, default="")
    # JSON: {"max_pages": 50, "discover": true, "heuristics": true}

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Order(Base):
    """会员升级订单（模拟支付）"""

    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    plan: Mapped[str] = mapped_column(String(20))
    amount: Mapped[int] = mapped_column()  # 金额（元）
    status: Mapped[str] = mapped_column(String(10), default="paid")  # paid / refunded
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="orders")


class LoginLog(Base):
    """登录/注册/重置密码的安全日志"""

    __tablename__ = "login_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(20), default="login")  # login / register / reset
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped[User] = relationship(back_populates="login_logs")


class ResearchTask(Base):
    """一次竞品调研任务"""

    __tablename__ = "research_tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    org_id: Mapped[str] = mapped_column(String(32), default="", index=True)  # 创建时所属企业，空串为个人任务
    tracker_id: Mapped[str] = mapped_column(String(32), default="", index=True)  # 由追踪项调度产生时记录
    product_name: Mapped[str] = mapped_column(String(200))
    competitors: Mapped[str] = mapped_column(Text, default="")  # 用户指定的竞品，逗号分隔，可为空
    focus: Mapped[str] = mapped_column(Text, default="")  # 调研重点，可为空
    time_range: Mapped[str] = mapped_column(String(10), default="year")  # 检索时效：''/day/week/month/year
    # pending / planning / searching / analyzing / reporting / completed / failed
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    error: Mapped[str] = mapped_column(Text, default="")
    report_markdown: Mapped[str] = mapped_column(Text, default="")
    report_data: Mapped[str] = mapped_column(Text, default="")  # 结构化洞察 JSON（评分/SWOT/结论）
    change_summary: Mapped[str] = mapped_column(Text, default="")  # 与上一期报告对比的本期变更 markdown
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    steps: Mapped[list["TaskStep"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="TaskStep.seq"
    )
    sources: Mapped[list["Source"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="Source.id"
    )
    user: Mapped[User] = relationship(back_populates="tasks")

    @property
    def creator_nickname(self) -> str:
        """创建人昵称，供企业共享任务列表展示"""
        return self.user.nickname if self.user else ""


class TaskStep(Base):
    """任务执行过程中的步骤日志，用于进度时间线"""

    __tablename__ = "task_steps"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(ForeignKey("research_tasks.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(default=0)  # 步骤序号，保证展示顺序
    phase: Mapped[str] = mapped_column(String(20))  # planning / searching / analyzing / reporting / done / error
    title: Mapped[str] = mapped_column(String(200))
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    task: Mapped[ResearchTask] = relationship(back_populates="steps")


class Source(Base):
    """调研过程中引用的网络信息来源"""

    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("research_tasks.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500), default="")
    url: Mapped[str] = mapped_column(String(1000))
    snippet: Mapped[str] = mapped_column(Text, default="")
    score: Mapped[float] = mapped_column(default=0.0)  # Tavily 相关度分 0~1
    domain: Mapped[str] = mapped_column(String(255), default="")
    tier: Mapped[str] = mapped_column(String(20), default="other")  # official / media / community / other
    published_at: Mapped[str] = mapped_column(String(50), default="")  # 来源发布时间（原始字符串，可空）
    dimension: Mapped[str] = mapped_column(String(100), default="")  # 来自哪组检索维度
    raw_content: Mapped[str] = mapped_column(Text, default="")  # 原文摘录（截断保存，供列表展示）

    # 来源存证与置信度（Agent 7 新增）
    confidence: Mapped[float] = mapped_column(default=0.0)
    conflict_status: Mapped[str] = mapped_column(String(20), default="none")
    conflict_note: Mapped[str] = mapped_column(Text, default="")
    is_duplicate: Mapped[bool] = mapped_column(Boolean, default=False)
    dedup_group: Mapped[str] = mapped_column(String(32), default="")
    access_status: Mapped[str] = mapped_column(String(20), default="")
    access_error: Mapped[str] = mapped_column(Text, default="")
    collected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    task: Mapped[ResearchTask] = relationship(back_populates="sources")

    @property
    def age_days(self) -> int:
        """距今天数（按基准时间计算），无发布日期返回 -1"""
        from app.core.timeutil import age_days_of, parse_published

        return age_days_of(parse_published(self.published_at))


class SourceArchive(Base):
    """来源存证快照：页面 HTML + 纯文本 + 采集元数据"""

    __tablename__ = "source_archives"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(String(32), index=True)
    source_id: Mapped[int] = mapped_column(index=True)

    snapshot_html: Mapped[str] = mapped_column(Text, default="")
    snapshot_text: Mapped[str] = mapped_column(Text, default="")
    snapshot_format: Mapped[str] = mapped_column(String(20), default="html")

    published_at: Mapped[str] = mapped_column(String(50), default="")
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    access_status: Mapped[str] = mapped_column(String(20), default="success")
    access_error: Mapped[str] = mapped_column(Text, default="")

    raw_content_full: Mapped[str] = mapped_column(Text, default="")


class ProfileTemplate(Base):
    """画像模板：固定维度定义，冻结后不可修改"""

    __tablename__ = "profile_templates"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    name: Mapped[str] = mapped_column(String(200))
    dimensions: Mapped[str] = mapped_column(Text)
    # JSON: [{"key": "product_overview", "label": "产品概况",
    #         "fields": [{"key": "name", "label": "名称", "type": "text"},
    #                    {"key": "price", "label": "价格区间", "type": "text"}]}]
    version: Mapped[int] = mapped_column(default=1)
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CompetitorProfile(Base):
    """竞品画像：按模板维度生成的结构化数据"""

    __tablename__ = "competitor_profiles"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(32), index=True)
    competitor_id: Mapped[str] = mapped_column(String(32), index=True)
    template_id: Mapped[str] = mapped_column(String(32), index=True)

    profile_data: Mapped[str] = mapped_column(Text)
    # JSON: {"dimension_key": {"field_key": "value", ...}, ...}
    source_refs: Mapped[str] = mapped_column(Text, default="[]")
    # JSON: [{"url": "...", "title": "...", "snippet": "..."}] — 快照副本，避免悬空引用

    status: Mapped[str] = mapped_column(String(20), default="draft")
    # draft / reviewed / frozen
    frozen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class ProfileExtractTask(Base):
    """画像提取后台任务（持久化到数据库，避免进程重启丢失）"""

    __tablename__ = "profile_extract_tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    # task_id 与 CompetitorProfile 复用 UUID 格式

    competitor_id: Mapped[str] = mapped_column(String(32), index=True)
    template_id: Mapped[str] = mapped_column(String(32), index=True)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    org_id: Mapped[str] = mapped_column(String(32), default="", index=True)

    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    # pending / running / done / error

    current_step: Mapped[str] = mapped_column(String(50), default="")
    # 当前阶段描述（如 "正在分析页面..."）

    result: Mapped[str] = mapped_column(Text, default="")
    # JSON：完成时保存结果

    error: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Organization(Base):
    """企业组织：成员通过邀请码加入，套餐/配额/追踪项按企业维度共享"""

    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(100))
    plan: Mapped[str] = mapped_column(String(20), default="free")  # free / pro / enterprise
    plan_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    owner_id: Mapped[str] = mapped_column(String(32), index=True)
    invite_code: Mapped[str] = mapped_column(String(8), default=_invite_code, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Tracker(Base):
    """定时追踪项：按频率自动执行调研流水线并推送变更摘要"""

    __tablename__ = "trackers"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(32), index=True)
    creator_id: Mapped[str] = mapped_column(String(32), index=True)
    product_name: Mapped[str] = mapped_column(String(200))
    competitors: Mapped[str] = mapped_column(Text, default="")
    focus: Mapped[str] = mapped_column(Text, default="")
    time_range: Mapped[str] = mapped_column(String(10), default="year")  # 检索时效：''/day/week/month/year
    frequency: Mapped[str] = mapped_column(String(10), default="weekly")  # daily / weekly / monthly
    run_hour: Mapped[int] = mapped_column(default=9)  # 每期运行的整点（本地时区 0-23）
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    push_email: Mapped[bool] = mapped_column(Boolean, default=False)
    push_webhook: Mapped[bool] = mapped_column(Boolean, default=False)
    webhook_type: Mapped[str] = mapped_column(String(20), default="generic")  # wecom / dingtalk / feishu / generic
    webhook_url: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Notification(Base):
    """站内通知（铃铛消息）"""

    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    org_id: Mapped[str] = mapped_column(String(32), default="", index=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(500), default="")  # 前端路由，如 /app/tasks/{id}
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ServiceKey(Base):
    """外部服务 API 密钥（Fernet 加密存储）"""

    __tablename__ = "service_keys"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    service: Mapped[str] = mapped_column(String(50))  # llm / tavily / smtp
    encrypted_value: Mapped[str] = mapped_column(Text)
    label: Mapped[str] = mapped_column(String(100), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    @property
    def value(self) -> str:
        from app.core.crypto import decrypt
        return decrypt(self.encrypted_value)

    @value.setter
    def value(self, plaintext: str) -> None:
        from app.core.crypto import encrypt
        self.encrypted_value = encrypt(plaintext) if plaintext else ""


class UserPermission(Base):
    """用户权限：JSON 数组存储，轻量实现"""

    __tablename__ = "user_permissions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    permissions: Mapped[str] = mapped_column(Text, default="[]")
    # JSON: ["source:register", "profile:generate", ...]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AuditLog(Base):
    """审计日志：关键操作 + 模型调用 + 来源访问"""

    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    org_id: Mapped[str] = mapped_column(String(32), default="", index=True)

    action: Mapped[str] = mapped_column(String(50))
    resource_type: Mapped[str] = mapped_column(String(50))
    resource_id: Mapped[str] = mapped_column(String(32), default="")

    input: Mapped[str] = mapped_column(Text, default="")
    result: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20))
    error: Mapped[str] = mapped_column(Text, default="")

    model_name: Mapped[str] = mapped_column(String(100), default="")
    tokens_prompt: Mapped[int] = mapped_column(default=0)
    tokens_completion: Mapped[int] = mapped_column(default=0)
    cost: Mapped[float] = mapped_column(default=0.0)

    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    __table_args__ = (
        Index("idx_audit_action_resource", "action", "resource_type"),
        Index("idx_audit_created_at", "created_at"),
    )


@event.listens_for(AuditLog, "before_update")
@event.listens_for(AuditLog, "before_delete")
def _prevent_audit_modification(_mapper, _connection, _target):
    """审计日志写入后不可修改或删除（应用层保护）"""
    raise RuntimeError("审计日志不可修改或删除")


class ExecutionSnapshot(Base):
    """执行快照：记录调研任务的运行时环境与配置哈希"""

    __tablename__ = "execution_snapshots"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(String(32), index=True)
    tracker_id: Mapped[str] = mapped_column(String(32), index=True)
    task_id: Mapped[str] = mapped_column(String(32), index=True)

    config_hash: Mapped[str] = mapped_column(String(64))
    model_params: Mapped[str] = mapped_column(Text)
    kb_version: Mapped[str] = mapped_column(String(50), default="")
    deployment_env: Mapped[str] = mapped_column(String(100), default="")
    candidate_version: Mapped[str] = mapped_column(String(50), default="")
    build_hash: Mapped[str] = mapped_column(String(64), default="")

    created_by: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AssistantSession(Base):
    """全局 AI 助手会话：一个用户可有多个会话，每个会话一条连续对话"""

    __tablename__ = "assistant_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str] = mapped_column(String(200), default="新对话")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AssistantMessage(Base):
    """全局 AI 助手对话消息：归属于某个会话（session_id），可按会话清空"""

    __tablename__ = "assistant_messages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    session_id: Mapped[str] = mapped_column(String(32), index=True, default="")
    role: Mapped[str] = mapped_column(String(10))  # user / assistant
    content: Mapped[str] = mapped_column(Text, default="")
    refs: Mapped[str] = mapped_column(Text, default="")  # 引用的报告 JSON 数组 [{task_id, product_name}]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class EmailLog(Base):
    """邮件发送记录：SMTP 未配置时以演示模式落库（status=demo）"""

    __tablename__ = "email_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    to_email: Mapped[str] = mapped_column(String(255), index=True)
    subject: Mapped[str] = mapped_column(String(300), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(10), default="demo")  # sent / demo / failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# ---------------------------------------------------------------------------
# 产业链关系图谱（模块B）
# ---------------------------------------------------------------------------

class GraphProject(Base):
    """一次关系图谱构建任务：以某个根对象为中心抽取产业链关系网络"""

    __tablename__ = "graph_projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    org_id: Mapped[str] = mapped_column(String(32), default="", index=True)  # 创建时所属企业，空串为个人
    root_name: Mapped[str] = mapped_column(String(200))  # 根对象（企业/产品）名称
    industry: Mapped[str] = mapped_column(String(100), default="")  # 所属行业（可选，辅助检索）
    time_range: Mapped[str] = mapped_column(String(10), default="year")  # 检索时效
    # pending / building / completed / failed
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    error: Mapped[str] = mapped_column(Text, default="")
    report_markdown: Mapped[str] = mapped_column(Text, default="")  # 构建完成后生成的关系网络分析报告
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    entities: Mapped[list["GraphEntity"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="GraphEntity.id"
    )
    relations: Mapped[list["GraphRelation"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="GraphRelation.id"
    )


class GraphEntity(Base):
    """图谱中的实体节点（企业/产品/机构/人物）"""

    __tablename__ = "graph_entities"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("graph_projects.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(20), default="company")  # company / product / org / person
    industry: Mapped[str] = mapped_column(String(100), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    is_root: Mapped[bool] = mapped_column(Boolean, default=False)

    project: Mapped[GraphProject] = relationship(back_populates="entities")


class GraphRelation(Base):
    """图谱中的关系边（上下游/竞争/合作/投资/母子公司）"""

    __tablename__ = "graph_relations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("graph_projects.id", ondelete="CASCADE"), index=True
    )
    source_id: Mapped[str] = mapped_column(String(32), index=True)
    target_id: Mapped[str] = mapped_column(String(32), index=True)
    # upstream_supplier / downstream_customer / competitor / partner / investor / parent / subsidiary
    relation_type: Mapped[str] = mapped_column(String(30), default="partner")
    description: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[float] = mapped_column(default=0.6)  # 关系置信度 0~1
    source_url: Mapped[str] = mapped_column(String(1000), default="")  # 关系依据来源链接

    project: Mapped[GraphProject] = relationship(back_populates="relations")

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    tasks: Mapped[list["ResearchTask"]] = relationship(back_populates="user")
    orders: Mapped[list["Order"]] = relationship(back_populates="user", order_by="Order.created_at.desc()")
    login_logs: Mapped[list["LoginLog"]] = relationship(
        back_populates="user", order_by="LoginLog.created_at.desc()"
    )


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
    product_name: Mapped[str] = mapped_column(String(200))
    competitors: Mapped[str] = mapped_column(Text, default="")  # 用户指定的竞品，逗号分隔，可为空
    focus: Mapped[str] = mapped_column(Text, default="")  # 调研重点，可为空
    # pending / planning / searching / analyzing / reporting / completed / failed
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    error: Mapped[str] = mapped_column(Text, default="")
    report_markdown: Mapped[str] = mapped_column(Text, default="")
    report_data: Mapped[str] = mapped_column(Text, default="")  # 结构化洞察 JSON（评分/SWOT/结论）
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    steps: Mapped[list["TaskStep"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="TaskStep.seq"
    )
    sources: Mapped[list["Source"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="Source.id"
    )
    user: Mapped[User] = relationship(back_populates="tasks")


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
    raw_content: Mapped[str] = mapped_column(Text, default="")  # 原文摘录（截断保存）

    task: Mapped[ResearchTask] = relationship(back_populates="sources")

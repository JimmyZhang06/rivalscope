from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置，从环境变量 / .env 文件读取"""

    # LLM（OpenAI 兼容接口）
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "deepseek-chat"

    # Tavily 联网检索
    tavily_api_key: str = ""

    # 时效性引擎：调研基准时间覆盖（ISO 日期，空则用真实当前时间；便于演示/回测）
    research_now_override: str = ""

    # 数据库
    database_url: str = "sqlite:///./research.db"

    # JWT 认证
    jwt_secret: str = "change-me-in-production-9f8e7d6c5b4a"
    jwt_expire_days: int = 7

    # SMTP 邮件推送（可选，不配置则邮件走演示模式落库 email_logs）
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    # 前端基础 URL：邮件 / webhook 中「查看完整报告」链接前缀，生产环境需按实际域名配置
    frontend_base: str = "http://localhost:5173"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()

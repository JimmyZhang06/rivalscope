from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """应用配置，从环境变量 / .env 文件读取"""

    # LLM（OpenAI 兼容接口）
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "deepseek-chat"
    llm_timeout_seconds: int = 60

    # Tavily 联网检索
    tavily_api_key: str = ""

    # 时效性引擎：调研基准时间覆盖（ISO 日期，空则用真实当前时间；便于演示/回测）
    research_now_override: str = ""

    # 数据库
    database_url: str = "sqlite:///./research.db"

    # JWT 认证（必须通过环境变量设置，不可使用默认值）
    jwt_secret: str = ""
    jwt_expire_days: int = 1  # access token 有效期（天）
    jwt_issuer: str = "comp-agent"

    # Fernet 加密主密钥（用于加密数据库中敏感字段）
    master_key: str = ""

    # SMTP 邮件推送（可选，不配置则邮件走演示模式落库 email_logs）
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    # 前端基础 URL：邮件 / webhook 中「查看完整报告」链接前缀，生产环境需按实际域名配置
    frontend_base: str = "http://localhost:5173"

    # CORS 允许的源（逗号分隔）
    frontend_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()

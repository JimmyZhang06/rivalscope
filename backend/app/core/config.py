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

    # 数据库
    database_url: str = "sqlite:///./research.db"

    # JWT 认证
    jwt_secret: str = "change-me-in-production-9f8e7d6c5b4a"
    jwt_expire_days: int = 7

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()

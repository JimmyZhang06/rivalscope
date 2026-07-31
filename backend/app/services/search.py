from tavily import AsyncTavilyClient

from app.core.config import get_settings


class SearchClient:
    """Tavily 联网检索客户端封装"""

    def __init__(self) -> None:
        settings = get_settings()
        self.client = AsyncTavilyClient(api_key=settings.tavily_api_key)

    async def search(
        self,
        query: str,
        max_results: int = 5,
        time_range: str = "",
        topic: str = "",
    ) -> list[dict]:
        """执行一次搜索，返回 [{title, url, content, score, raw_content, published_date}] 列表

        score/raw_content/published_date 由 Tavily 提供，可能缺失，做好兜底。
        time_range 透传 Tavily 时间范围（day/week/month/year，空则不限）；
        topic 可选（如 news），空则用 Tavily 默认。
        """
        kwargs: dict = {
            "query": query,
            "max_results": max_results,
            "search_depth": "basic",
            "include_raw_content": True,
        }
        if time_range in ("day", "week", "month", "year"):
            kwargs["time_range"] = time_range
        if topic:
            kwargs["topic"] = topic
        resp = await self.client.search(**kwargs)
        results = []
        for item in resp.get("results", []):
            results.append(
                {
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "content": item.get("content", ""),
                    "score": float(item.get("score") or 0.0),
                    "raw_content": item.get("raw_content") or "",
                    "published_date": item.get("published_date") or "",
                }
            )
        return results

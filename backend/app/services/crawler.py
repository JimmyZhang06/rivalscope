"""竞品官网爬取引擎：Sitemap 发现 + 链接递归 + 并发抓取 + 正文提取"""

import asyncio
import json
import logging
import re
import xml.etree.ElementTree as ET
from collections import deque
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from readability import Document

from app.core.timeutil import utcnow
from app.db.database import SessionLocal
from app.db.models import Competitor, CompetitorPage, CrawlTask

logger = logging.getLogger(__name__)

# 并发限制 + 同域延迟
_CONCURRENCY = 5
_DOMAIN_DELAY = 0.5  # 秒
_MAX_PAGES_DEFAULT = 50
_MAX_DEPTH = 2  # 从发现入口出发的最大跳数

# 有价值路径的正则（排除 /blog/* 等大量重复页面）
_PATH_RE = re.compile(
    r"/(pricing|price|features|products|about(-us)?|customers|case[-_]stud(y|ies)"
    r"|docs|help|support|enterprise|solutions|integrations?|technology|company"
    r"|careers?|press|news|contact|faq|security|privacy|terms)"
    r"|(/product(s)?/[^/]+)$",
    re.I,
)

# 应排除的路径模式
_EXCLUDE_RE = re.compile(
    r"/(blog|news|article|post|tag|category|archive|author|search|login|signup|register)"
    r"(\/|$|\?)",
    re.I,
)

_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"


# ---------------------------------------------------------------------------
# 页面发现
# ---------------------------------------------------------------------------

async def discover_urls(base_url: str, max_pages: int = _MAX_PAGES_DEFAULT) -> list[str]:
    """
    从多个渠道发现站内 URL，返回去重后的列表。
    优先级：Sitemap > 首页链接发现 + 启发式路径
    """
    urls: set[str] = set()
    base = _normalize_base(base_url)
    parsed = urlparse(base)

    # 保留原始 URL 的语言路径前缀（如 /cn, /en, /ja）
    original_path = urlparse(base_url).path.rstrip("/")
    lang_prefix = ""
    m = re.match(r"^/(cn|en|de|fr|ja|ko|es|pt|it|ru|zh|zh-cn|zh-tw)(/|$)", original_path)
    if m:
        lang_prefix = m.group(1)

    # 1. Sitemap（多路径尝试）
    sitemap_urls = await _fetch_sitemap_urls(base, lang_prefix)
    # 如果有语言前缀，过滤掉其他语言的 URL（sitemap 通常包含所有语言版本）
    if lang_prefix:
        lang_re = re.compile(rf"^https?://[^/]+/{lang_prefix}/", re.I)
        for u in sitemap_urls:
            if _is_same_domain(u, parsed) and lang_re.match(u):
                urls.add(u)
    else:
        for u in sitemap_urls:
            if _is_same_domain(u, parsed):
                urls.add(u)
    if len(urls) >= max_pages:
        return sorted(urls)[:max_pages]

    # 2. 首页链接发现（BFS，限制深度）
    homepage = base if not lang_prefix else f"{base}/{lang_prefix}"
    discovered = await _discover_from_homepage(homepage, max_depth=_MAX_DEPTH)
    for u in discovered:
        if _is_same_domain(u, parsed):
            urls.add(u)
    if len(urls) >= max_pages:
        return sorted(urls)[:max_pages]

    # 3. 启发式关键路径（带语言前缀）
    heuristics = [
        "/pricing", "/features", "/products", "/about", "/about-us",
        "/customers", "/case-studies", "/docs", "/help", "/enterprise",
        "/solutions", "/integrations", "/technology", "/company",
        "/security", "/privacy", "/contact", "/faq",
    ]
    prefix = f"/{lang_prefix}" if lang_prefix else ""
    for path in heuristics:
        candidate = f"{base}{prefix}{path}"
        if candidate not in urls:
            urls.add(candidate)

    return sorted(urls)[:max_pages]


async def _fetch_sitemap_urls(base: str, lang_prefix: str = "") -> list[str]:
    """尝试从多个路径获取 sitemap 并解析所有 <loc> URL"""
    urls: list[str] = []
    candidates = ["/sitemap.xml"]
    if lang_prefix:
        candidates = [f"/{lang_prefix}/sitemap.xml", "/sitemap.xml"]

    for sm_path in candidates:
        sm_url = urljoin(base, sm_path)
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                resp = await client.get(sm_url, headers={"User-Agent": _USER_AGENT})
                if resp.status_code != 200:
                    continue
                content = resp.text
        except Exception:
            continue

        try:
            root = ET.fromstring(content)
            tag = root.tag.lower()
            if "sitemapindex" in tag:
                for sm_loc in root.findall(".//{*}loc"):
                    if sm_loc.text:
                        child_urls = await _fetch_sitemap_urls(sm_loc.text.strip(), lang_prefix)
                        urls.extend(child_urls)
            else:
                for loc in root.findall(".//{*}loc"):
                    if loc.text:
                        urls.append(loc.text.strip())
            if urls:
                break  # 找到了就停止尝试其他路径
        except ET.ParseError:
            logger.warning("sitemap parse failed for %s", sm_url)

    return urls


async def _discover_from_homepage(base: str, max_depth: int = 2) -> list[str]:
    """从首页开始 BFS 发现内部链接"""
    discovered: set[str] = set()
    queue: deque[tuple[str, int]] = deque([(base, 0)])
    parsed_base = urlparse(base)

    while queue and len(discovered) < 100:
        url, depth = queue.popleft()
        if url in discovered or depth > max_depth:
            continue
        discovered.add(url)

        if depth >= max_depth:
            continue

        links = await _extract_links(url, parsed_base)
        for link in links:
            queue.append((link, depth + 1))

    return list(discovered)


async def _extract_links(page_url: str, parsed_base: Any) -> list[str]:
    """从页面提取有效内部链接"""
    links: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(page_url, headers={"User-Agent": _USER_AGENT})
            if resp.status_code != 200:
                return links
            soup = BeautifulSoup(resp.text[:200_000], "html.parser")
    except Exception:
        return links

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("javascript:", "mailto:", "tel:")):
            continue
        absolute = urljoin(page_url, href)
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            continue
        # 清理锚点 + 去重尾部斜杠
        clean = parsed._replace(fragment="").geturl().rstrip("/")
        if not clean:
            continue
        # 排除不有价值的路径
        if _EXCLUDE_RE.search(parsed.path):
            continue
        # 只保留有价值路径或同域路径
        if _is_same_domain(clean, parsed_base) and (
            _PATH_RE.search(parsed.path) or len(parsed.path) <= 1
        ):
            links.append(clean)

    return list(set(links))


# ---------------------------------------------------------------------------
# 页面抓取
# ---------------------------------------------------------------------------

async def fetch_pages(urls: list[str]) -> list[dict[str, Any]]:
    """
    并发抓取多个页面，对每个页面做 readability 正文提取。
    返回 [{url, title, content_text, content_html, access_status, access_error}, ...]
    """
    semaphore = asyncio.Semaphore(_CONCURRENCY)
    results: list[dict[str, Any]] = []
    domain_times: dict[str, float] = {}

    async def _fetch_one(url: str) -> dict[str, Any]:
        async with semaphore:
            parsed = urlparse(url)
            host = parsed.netloc.lower()
            now = asyncio.get_event_loop().time()
            last = domain_times.get(host, 0.0)
            wait = _DOMAIN_DELAY - (now - last)
            if wait > 0:
                await asyncio.sleep(wait)
            domain_times[host] = asyncio.get_event_loop().time()

            return await _fetch_single(url)

    tasks = [_fetch_one(u) for u in urls]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return [r for r in results if isinstance(r, dict)]


async def _fetch_single(url: str) -> dict[str, Any]:
    """抓取单个页面并提取正文"""
    now = datetime.now(timezone.utc)
    result: dict[str, Any] = {
        "url": url,
        "title": "",
        "content_text": "",
        "content_html": "",
        "access_status": "success",
        "access_error": "",
    }

    html = ""
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": _USER_AGENT})
            resp.raise_for_status()
            html = resp.text[:500_000]
    except Exception as exc:
        logger.warning("fetch failed for %s: %s", url, exc)
        result["access_status"] = "failed"
        result["access_error"] = str(exc)[:500]
        return result

    # 移除常见的 cookie / 隐私 consent overlay（它们会干扰 readability 提取）
    html = re.sub(
        r'<div[^>]*\bclass\s*=\s*"[^"]*(?:consent|cookie|privacy-notice|gdpr|ccpa|onetrust|modalBody|modal|overlay|banner)[^"]*"[^>]*>.*?</div>',
        '', html, flags=re.DOTALL | re.IGNORECASE
    )
    html = re.sub(
        r'<div[^>]*\bclass\s*=\s*\'[^\']*(?:consent|cookie|privacy-notice|gdpr|ccpa|onetrust|modalBody|modal|overlay|banner)[^\']*\'[^>]*>.*?</div>',
        '', html, flags=re.DOTALL | re.IGNORECASE
    )
    # 移除 script / style 后提取正文
    soup_clean = BeautifulSoup(html, "html.parser")
    for tag in soup_clean(["script", "style", "noscript"]):
        tag.decompose()

    # 用 readability 提取正文
    try:
        doc = Document(str(soup_clean))
        content_html = doc.summary()
        soup_content = BeautifulSoup(content_html, "html.parser")
        content_text = soup_content.get_text(separator="\n", strip=True)
        title = doc.short_title() or _extract_title(html)
    except Exception:
        # readability 失败，降级到 BS4
        content_text = soup_clean.get_text(separator="\n", strip=True)
        content_html = ""
        title = _extract_title(html)

    # 检查 readability 是否只提取到了 consent overlay 而非实际正文
    _CONSENT_MARKERS = [
        "data subjects only", "targeted advertising", "selling.*sharing",
        "privacy practices", "opt out", "ccpa", "gdpr consent",
    ]
    if len(content_text) < 3000:
        body_text = soup_clean.get_text(separator="\n", strip=True)
        is_consent_only = any(
            re.search(m, content_text, re.IGNORECASE)
            for m in _CONSENT_MARKERS
        )
        if is_consent_only and len(body_text) > len(content_text):
            # readability 只提取到了 consent overlay，回退到完整 body 文本
            content_text = body_text
            content_html = ""

    result.update({
        "title": title[:500],
        "content_text": content_text[:200_000],
        "content_html": content_html[:200_000],
        "access_status": "success",
    })
    return result


def _extract_title(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find("meta", property="og:title")
    if tag and tag.get("content"):
        return tag["content"].strip()
    tag = soup.find("title")
    if tag:
        return tag.get_text(strip=True)
    return ""


# ---------------------------------------------------------------------------
# 全站爬取编排
# ---------------------------------------------------------------------------

async def crawl_competitor_site(
    competitor_id: str,
    max_pages: int = _MAX_PAGES_DEFAULT,
    user_id: str = "",
    task_id: str = "",
) -> dict[str, Any]:
    """
    完整爬取流程：发现 URL → 批量抓取 → 存储到 DB → 更新 Competitor 状态。
    如果传入 task_id，则复用已有的 CrawlTask 记录，避免重复创建。
    返回任务摘要。
    """
    with SessionLocal() as db:
        competitor = db.get(Competitor, competitor_id)
        if not competitor:
            raise ValueError("竞品不存在")
        if not competitor.website:
            raise ValueError("竞品未设置官网地址")

        base_url = competitor.website.strip()
        if not base_url.startswith(("http://", "https://")):
            base_url = "https://" + base_url

        if task_id:
            task = db.get(CrawlTask, task_id)
            if not task:
                raise ValueError(f"爬取任务 {task_id} 不存在")
        else:
            task = CrawlTask(
                competitor_id=competitor_id,
                org_id=competitor.org_id,
                user_id=user_id,
                status="running",
                crawl_config=_json_config(max_pages),
            )
            db.add(task)
        # 更新竞品状态
        competitor.crawl_status = "running"
        competitor.crawl_error = ""
        db.commit()
        db.refresh(task)
        db.refresh(competitor)
        task_id = task.id
        org_id = competitor.org_id

    try:
        # Phase 1: 发现 URL
        logger.info("crawl %s: discovering URLs from %s", competitor_id, base_url)
        urls = await discover_urls(base_url, max_pages=max_pages)

        # Phase 2: 批量抓取
        logger.info("crawl %s: fetching %d pages", competitor_id, len(urls))
        pages = await fetch_pages(urls)

        # Phase 3: 存储
        crawled_count = 0
        with SessionLocal() as db:
            task = db.get(CrawlTask, task_id)
            competitor = db.get(Competitor, competitor_id)
            for page_data in pages:
                cp = CompetitorPage(
                    competitor_id=competitor_id,
                    url=page_data["url"],
                    page_type=_classify_page_type(page_data["url"]),
                    title=page_data.get("title", ""),
                    content_text=page_data.get("content_text", ""),
                    content_html=page_data.get("content_html", ""),
                    access_status=page_data.get("access_status", "success"),
                    access_error=page_data.get("access_error", ""),
                )
                db.add(cp)
                crawled_count += 1

            # 更新任务 + 竞品状态
            task.status = "done"
            task.total_pages = len(urls)
            task.crawled_pages = crawled_count
            task.completed_at = utcnow()
            competitor.last_crawled_at = utcnow()
            competitor.crawl_status = "done"
            competitor.crawl_error = ""
            db.commit()

        return {
            "task_id": task_id,
            "status": "done",
            "total_pages": len(urls),
            "crawled_pages": crawled_count,
        }

    except Exception as exc:
        logger.exception("crawl failed for competitor %s", competitor_id)
        with SessionLocal() as db:
            task = db.get(CrawlTask, task_id)
            competitor = db.get(Competitor, competitor_id)
            if task:
                task.status = "error"
                task.error = str(exc)[:500]
            if competitor:
                competitor.crawl_status = "error"
                competitor.crawl_error = str(exc)[:500]
            db.commit()
        raise


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

def _normalize_base(url: str) -> str:
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def _is_same_domain(url: str, reference: Any) -> bool:
    parsed = urlparse(url)
    ref_netloc = reference.netloc.lower().removeprefix("www.") if hasattr(reference, "netloc") else ""
    target = parsed.netloc.lower().removeprefix("www.")
    return bool(target and target == ref_netloc)


def _classify_page_type(url: str) -> str:
    """根据 URL 路径推断页面类型（先去掉语言前缀）"""
    parsed = urlparse(url)
    path = re.sub(r"^/(cn|en|de|fr|ja|ko|es|pt|it|ru|zh)/", "/", parsed.path).lower().rstrip("/")
    if not path or path == "/":
        return "home"
    segment = path.split("/")[1] if "/" in path else path
    segment = segment.split(".")[0]
    _TYPE_MAP = {
        "pricing": "pricing", "price": "pricing", "prices": "pricing",
        "features": "features", "feature": "features",
        "products": "products", "product": "products",
        "about": "about", "about-us": "about",
        "customers": "customers",
        "case-studies": "case_studies", "case-study": "case_studies",
        "docs": "docs", "documentation": "docs",
        "help": "help", "support": "help",
        "enterprise": "enterprise",
        "solutions": "solutions",
        "integrations": "integrations", "integration": "integrations",
        "technology": "technology",
        "company": "company",
        "careers": "careers", "career": "careers",
        "security": "security",
        "privacy": "privacy",
        "terms": "terms",
        "newsroom": "news", "press": "press",
        "contact": "contact", "faq": "faq",
        "repair": "help",
    }
    return _TYPE_MAP.get(segment, "other")


def _json_config(max_pages: int) -> str:
    return json.dumps({"max_pages": max_pages, "discover": True, "heuristics": True})


# ---------------------------------------------------------------------------
# 定向抓取辅助函数（供产品情报服务调用）
# ---------------------------------------------------------------------------

async def fetch_single_page(url: str) -> dict[str, Any]:
    """
    定向抓取单个页面（不经过 discover/fetch_pages 全站流程）。
    返回 {url, title, content_text, content_html, page_type, access_status, access_error}

    与 _fetch_single() 的区别：
    - 不需要 semaphore 和 domain delay（少量 URL 不需要）
    - content_text 截断到 5000 chars（画像提取足够）
    - 不依赖 _MAX_PAGES 等全站爬取参数
    - 不存储到 DB（调用方自行决定是否存入 CompetitorPage）
    """
    return await _fetch_single_with_limit(url, max_chars=_MAX_CRAWLED_CHARS)


async def _fetch_single_with_limit(url: str, max_chars: int = 5000) -> dict[str, Any]:
    """内部：抓取单页并截断 content_text 到 max_chars"""
    result: dict[str, Any] = {
        "url": url,
        "title": "",
        "content_text": "",
        "content_html": "",
        "page_type": _classify_page_type(url),
        "access_status": "failed",
        "access_error": "",
    }

    html = ""
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": _USER_AGENT})
            resp.raise_for_status()
            html = resp.text[:500_000]
    except Exception as exc:
        logger.warning("fetch_single_page failed for %s: %s", url, exc)
        result["access_error"] = str(exc)[:500]
        return result

    try:
        doc = Document(html)
        content_html = doc.summary()
        soup = BeautifulSoup(content_html, "html.parser")
        content_text = soup.get_text(separator="\n", strip=True)
        title = doc.short_title() or _extract_title(html)
    except Exception:
        soup = BeautifulSoup(html, "html.parser")
        content_text = soup.get_text(separator="\n", strip=True)
        content_html = ""
        title = _extract_title(html)

    result.update({
        "title": title[:500],
        "content_text": content_text[:max_chars],
        "content_html": content_html[:200_000],
        "access_status": "success",
    })
    return result

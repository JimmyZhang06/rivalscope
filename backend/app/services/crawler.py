"""竞品官网爬取引擎：Sitemap 发现 + 链接递归 + 并发抓取 + 正文提取"""

import asyncio
import gzip
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
    r"|docs|help|support(/product)?|enterprise|solutions|integrations?|technology|company"
    r"|careers?|press|news|newsroom|contact|faq|security|privacy|terms)"
    r"|(/product(s)?/[^/]+)$",
    re.I,
)

# 应排除的路径模式（只排除大量重复的低价值页面）
_EXCLUDE_RE = re.compile(
    r"/(blog|article|post|tag|category|archive|author|search|login|signup|register)"
    r"(\/|$|\?)",
    re.I,
)
# 额外排除内部功能页（cookie/会员/留言等）
_INTERNAL_EXCLUDE_RE = re.compile(
    r"/(h-cookie|h-login|h-mCenter|h-msgBoard|h-col-101|h-col-102|h-col-103|h-col-105|h-col-106|h-col-146)(\.html)?(\/|$)",
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

    # 1. Sitemap 和 2. 首页链接发现 并行执行（取两者的并集）
    # Sitemap 覆盖历史页面，首页 BFS 覆盖当前产品/子域链接（如 store.dji.com）
    homepage = base if not lang_prefix else f"{base}/{lang_prefix}"

    # 并行收集两个渠道的 URL
    async def _collect_sitemap() -> set[str]:
        sitemap_urls = await _fetch_sitemap_urls(base, lang_prefix)
        result: set[str] = set()
        if lang_prefix:
            lang_re = re.compile(rf"^https?://[^/]+/{lang_prefix}/", re.I)
            for u in sitemap_urls:
                if not _is_same_domain(u, parsed):
                    continue
                if lang_re.match(u):
                    result.add(u)
            # 回退：补全语言前缀
            if len(result) < max_pages // 2:
                for u in sitemap_urls:
                    if not _is_same_domain(u, parsed):
                        continue
                    p = urlparse(u)
                    if p.path in ("/", ""):
                        continue
                    if re.match(rf"^https?://[^/]+/{lang_prefix}/", u, re.I):
                        continue
                    normalized = f"{parsed.scheme}://{parsed.netloc}/{lang_prefix}{p.path}"
                    result.add(normalized)
        else:
            for u in sitemap_urls:
                if _is_same_domain(u, parsed):
                    result.add(u)
        return result

    async def _collect_homepage() -> set[str]:
        # 只需深度 1：首页本身通常包含产品/子域链接（如 store.dji.com）
        # 深度 2 会导致大量子页面请求，对产品序列场景没有必要
        discovered = await _discover_from_homepage(homepage, max_depth=1)
        return {u for u in discovered if _is_same_domain(u, parsed)}

    sitemap_urls_set, homepage_urls_set = await asyncio.gather(
        _collect_sitemap(), _collect_homepage()
    )
    urls = sitemap_urls_set | homepage_urls_set

    # 3. 启发式关键路径（带语言前缀）
    if len(urls) < max_pages:
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


async def _fetch_sitemap_urls(base: str, lang_prefix: str = "", max_urls: int = 0) -> list[str]:
    """尝试从多个路径获取 sitemap 并解析所有 <loc> URL

    支持 .xml 和 .xml.gz（gzip 压缩）格式。
    当 max_urls > 0 时，达到上限后立即停止拉取子 sitemap。
    """
    urls: list[str] = []
    # 同时支持 sitemap.xml 和 sitemap_index.xml
    candidates = ["/sitemap.xml", "/sitemap_index.xml"]
    if lang_prefix:
        candidates = [f"/{lang_prefix}/sitemap.xml", f"/{lang_prefix}/sitemap_index.xml", "/sitemap.xml", "/sitemap_index.xml"]

    for sm_path in candidates:
        sm_url = urljoin(base, sm_path)
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                resp = await client.get(sm_url, headers={"User-Agent": _USER_AGENT})
                if resp.status_code != 200:
                    continue
                content = resp.text
                # 检测 gzip 压缩：resp.text 解码后如果前几个字节是乱码说明实际是二进制
                if resp.headers.get("content-type", "").startswith("application/gzip") or sm_url.endswith(".gz"):
                    try:
                        content = gzip.decompress(resp.content).decode("utf-8")
                    except Exception:
                        logger.warning("gzip decompress failed for %s", sm_url)
                        continue
        except Exception:
            continue

        try:
            root = ET.fromstring(content)
            tag = root.tag.lower()
            if "sitemapindex" in tag:
                # 收集子 sitemap 地址（带 early stop）
                child_sitemaps: list[str] = []
                for sm_loc in root.findall(".//{*}loc"):
                    if sm_loc.text:
                        child_sitemaps.append(sm_loc.text.strip())
                        if max_urls > 0 and len(child_sitemaps) >= max_urls:
                            break
                # 并发拉取子 sitemap：最多拉 3 个子文件就够覆盖需求
                #（每个子文件含 ~100-140 个 URL）
                semaphore = asyncio.Semaphore(3)
                async def _fetch_child(child_url: str) -> list[str]:
                    try:
                        async with semaphore:
                            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                                r = await client.get(child_url, headers={"User-Agent": _USER_AGENT})
                                if r.status_code != 200:
                                    return []
                                text = r.text
                                if child_url.endswith(".gz") or r.headers.get("content-type", "").startswith("application/gzip"):
                                    try:
                                        text = gzip.decompress(r.content).decode("utf-8")
                                    except Exception:
                                        return []
                                child_root = ET.fromstring(text)
                                found = [loc.text.strip() for loc in child_root.findall(".//{*}loc") if loc.text]
                                return found
                    except Exception:
                        return []
                # 并发拉取子 sitemap：最多拉前 8 个子文件（覆盖 ~800-1100 个 URL）
                # DJI 等大站 52 个子 sitemap 分散在不同文件，8 个足以覆盖主要语言版本
                child_tasks = [_fetch_child(c) for c in child_sitemaps[:8]]
                child_results = await asyncio.gather(*child_tasks, return_exceptions=True)
                for cr in child_results:
                    if isinstance(cr, list):
                        for u in cr:
                            if u not in urls:
                                urls.append(u)
            else:
                for loc in root.findall(".//{*}loc"):
                    if loc.text:
                        urls.append(loc.text.strip())
                        if max_urls > 0 and len(urls) >= max_urls:
                            return urls[:max_urls]
            if urls:
                break  # 找到了就停止尝试其他路径
        except ET.ParseError:
            logger.warning("sitemap parse failed for %s", sm_url)

    return urls[:max_urls] if max_urls > 0 else urls


async def _discover_from_homepage(base: str, max_depth: int = 2) -> list[str]:
    """从首页开始 BFS 发现内部链接"""
    discovered: set[str] = set()
    queue: deque[tuple[str, int]] = deque([(base, 0)])
    parsed_base = urlparse(base)

    while queue and len(discovered) < 100:
        url, depth = queue.popleft()
        # 在 popleft 后立即检查去重（而非在后续处理中）
        if url in discovered or depth > max_depth:
            continue
        discovered.add(url)  # ★ 先标记已访问，防止重复加入队列

        if depth >= max_depth:
            continue

        links = await _extract_links(url, parsed_base)
        for link in links:
            # 只加入未访问的链接
            if link not in discovered:
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

    # 先用 readability 提取正文
    content_text, content_html, title = _extract_content(soup_clean, html)

    # 检查提取是否足够（针对 JS 渲染站点的回退策略）
    _CONSENT_MARKERS = [
        "data subjects only", "targeted advertising", "selling.*sharing",
        "privacy practices", "opt out", "ccpa", "gdpr consent",
    ]
    body_text = soup_clean.get_text(separator="\n", strip=True)
    is_consent_only = len(content_text) < 3000 and any(
        re.search(m, content_text, re.IGNORECASE) for m in _CONSENT_MARKERS
    )

    if is_consent_only and len(body_text) > len(content_text):
        # readability 只提取到了 consent overlay，回退到完整 body 文本
        content_text = body_text
        content_html = ""
    elif len(content_text) < 500:
        # readability 内容太少，尝试 JS 渲染站点的 meta 标签回退
        _meta_content, _meta_title = _extract_from_meta(soup_clean, html)
        if len(_meta_content) > len(content_text):
            content_text = _meta_content
        if not title and _meta_title:
            title = _meta_title
        # 仍然不足（meta 通常只给 200 字摘要），尝试 jina.ai 回退
        if len(content_text) < 500:
            try:
                _jina_content, _jina_title = await _extract_via_jina(url)
            except Exception:
                _jina_content, _jina_title = "", ""
            if len(_jina_content) > len(content_text):
                content_text = _jina_content
            if not title and _jina_title:
                title = _jina_title
    # 额外检测：readability 提取了文字但内容全是导航/菜单（JS SPA 常见问题）
    # 表现为：内容 > 500 字符，但每行都很短（多为导航链接），实际正文很少
    elif len(content_text) >= 500 and len(content_text) < 5000:
        lines = [l.strip() for l in content_text.split("\n") if l.strip()]
        if lines:
            avg_line_len = sum(len(l) for l in lines) / len(lines)
            # 平均行长短于 40 字符且行数多 → 大概率是导航/菜单内容
            if avg_line_len < 40 and len(lines) > 30:
                try:
                    _jina_content, _jina_title = await _extract_via_jina(url)
                except Exception:
                    _jina_content, _jina_title = "", ""
                if len(_jina_content) > len(content_text):
                    content_text = _jina_content
                if not title and _jina_title:
                    title = _jina_title

    result.update({
        "title": title[:500],
        "content_text": content_text[:200_000],
        "content_html": content_html[:200_000],
        "access_status": "success",
    })
    return result


def _extract_content(soup_clean: Any, html: str) -> tuple[str, str, str]:
    """提取正文：readability → BS4 降级。返回 (content_text, content_html, title)。"""
    title = ""
    try:
        doc = Document(str(soup_clean))
        content_html = doc.summary()
        soup_content = BeautifulSoup(content_html, "html.parser")
        content_text = soup_content.get_text(separator="\n", strip=True)
        title = doc.short_title() or _extract_title(html)
        return content_text, content_html, title
    except Exception:
        pass
    # readability 失败，降级到 BS4
    content_text = soup_clean.get_text(separator="\n", strip=True)
    content_html = ""
    title = _extract_title(html)
    return content_text, content_html, title


def _extract_from_meta(soup_clean: Any, html: str) -> tuple[str, str]:
    """JS 渲染站点回退：从 meta 标签提取正文（常用于 CMS 构建的静态站点）。
    返回 (content_text, title)。
    """
    title = ""
    # 标题
    og_title = soup_clean.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        title = og_title["content"].strip()
    else:
        tag = soup_clean.find("title")
        if tag:
            title = tag.get_text(strip=True)

    # 正文：优先 meta description
    desc = soup_clean.find("meta", attrs={"name": re.compile(r"^description$", re.I)})
    if desc and desc.get("content"):
        content = desc["content"].strip()
        if len(content) >= 200:
            return content, title

    # 尝试从 JSON-LD 结构化数据提取
    ld_scripts = soup_clean.find_all("script", type="application/ld+json")
    for s in ld_scripts:
        try:
            import json as _json
            data = _json.loads(s.string or "")
            if isinstance(data, dict):
                body = data.get("articleBody") or data.get("description") or data.get("text", "")
                if body and len(body) >= 200:
                    return body.strip(), title
        except Exception:
            continue

    return "", title


async def _extract_via_jina(url: str) -> tuple[str, str]:
    """JS 渲染站点终极回退：通过 jina.ai HTTP API 获取渲染后的页面内容。
    返回 (content_text, title)。
    限流保护：失败时静默返回空，避免影响主流程。
    """
    try:
        import httpx
        api_url = f"https://r.jina.ai/{url}"
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(api_url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; CompAgent/1.0)",
                "Accept": "text/plain",
            })
            if resp.status_code == 200:
                text = resp.text
                # jina.ai 返回格式: "Title: xxx\n\nURL Source: xxx\n\nMarkdown Content:\n..."
                lines = text.split("\n")
                title = ""
                content_start = 0
                for i, line in enumerate(lines):
                    if line.startswith("Title:"):
                        title = line.replace("Title:", "").strip()
                    elif line.strip() == "Markdown Content:":
                        content_start = i + 1
                        break
                content = "\n".join(lines[content_start:]).strip()
                # 清理图片引用（减少 token 消耗）
                content = re.sub(r'!\[Image \d+:.*?\]\(.*?\)', '', content)
                return content, title
    except Exception as exc:
        logger.debug("jina.ai fallback failed for %s: %s", url, exc)
    return "", ""


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
    """检查 URL 是否属于同一域名（包含子域），如 www.dji.com 匹配 store.dji.com"""
    parsed = urlparse(url)
    ref_netloc = reference.netloc.lower() if hasattr(reference, "netloc") else ""
    target = parsed.netloc.lower()
    if not target or not ref_netloc:
        return False
    # 去除 www. 后做后缀匹配（www.dji.com ≈ store.dji.com ≈ dji.com）
    ref_root = ref_netloc.removeprefix("www.")
    target_stripped = target.removeprefix("www.")
    if target_stripped == ref_root:
        return True
    return target_stripped.endswith("." + ref_root)


def _classify_page_type(url: str) -> str:
    """根据 URL 路径推断页面类型（先去掉语言前缀）"""
    parsed = urlparse(url)
    path = re.sub(r"^/(cn|en|de|fr|ja|ko|es|pt|it|ru|zh)/", "/", parsed.path).lower().rstrip("/")
    if not path or path == "/":
        return "home"

    # 先匹配特定站点模式
    _SITE_TYPE_MAP = {
        # 常见路径关键词
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

    # 从路径尾部段匹配
    segments = path.split("/")
    for seg in reversed(segments):
        seg = seg.split(".")[0]  # 去掉扩展名
        if seg in _SITE_TYPE_MAP:
            return _SITE_TYPE_MAP[seg]

    # 常见 CMS 站点模式（华为云速建站等）
    if re.search(r"/h-col-", path):
        return "company"  # 栏目页通常是公司介绍类
    if re.search(r"/h-nd-\d+", path):
        # 文章/产品详情页：通过内容标题判断（需后续内容分析）
        return "products"
    if re.search(r"/h-nr-", path):
        return "solutions"
    if re.search(r"/h-news|/news/|/blog/", path):
        return "news"
    if re.search(r"/product[s]?/", path):
        return "products"
    if re.search(r"/solution[s]?/", path):
        return "solutions"

    return "other"


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

    # 正文提取（与 _fetch_single 相同的多级回退策略）
    soup_raw = BeautifulSoup(html, "html.parser")
    for tag in soup_raw(["script", "style", "noscript"]):
        tag.decompose()
    content_text, content_html, title = _extract_content(soup_raw, html)
    if len(content_text) < 500:
        _meta_content, _meta_title = _extract_from_meta(soup_raw, html)
        if len(_meta_content) > len(content_text):
            content_text = _meta_content
        if not title and _meta_title:
            title = _meta_title
        if len(content_text) < 500:
            try:
                _jina_content, _jina_title = await _extract_via_jina(url)
            except Exception:
                _jina_content, _jina_title = "", ""
            if len(_jina_content) > len(content_text):
                content_text = _jina_content
            if not title and _jina_title:
                title = _jina_title

    result.update({
        "title": title[:500],
        "content_text": content_text[:max_chars],
        "content_html": content_html[:200_000],
        "access_status": "success",
    })
    return result
# reload trigger

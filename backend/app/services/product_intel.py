"""产品情报服务：搜索优先 + 定向抓取 + LLM 综合的三层架构"""

import asyncio
import json
import logging
import re
import time
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from readability import Document

from app.core.timeutil import baseline_now
from app.core.url_security import normalize_and_validate_url, safe_external_request
from app.db.database import SessionLocal
from app.db.models import Competitor, CompetitorPage, CompetitorProfile, ProfileTemplate
from app.services.dedup import dedup_by_content, estimate_confidence
from app.services.llm import LLMClient
from app.services.search import SearchClient
from app.services.agent import classify_source

logger = logging.getLogger(__name__)

_KEY_URL_RE = re.compile(
    r"/(pricing|price|products|about|support|about-us)",
    re.I,
)
_MAX_KEY_URLS = 5
_MAX_CRAWLED_CHARS = 5000
_MIN_CONTENT_CHARS = 200
_MAX_CONCURRENT_CRAWLS = 2
_USER_AGENT = "Mozilla/5.0 (compatible; CompAgent-Intel/1.0)"


def _date_header() -> str:
    """从 agent.py 借用日期头"""
    from app.services.agent import _date_header as _dh
    return _dh()


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

async def generate_product_intel(
    competitor_id: str,
    template_id: str,
    user_id: str = "",
) -> dict:
    """三层架构生成竞品产品情报。返回标准画像结果。"""
    with SessionLocal() as db:
        competitor = db.get(Competitor, competitor_id)
        template = db.get(ProfileTemplate, template_id)
        if not competitor or not template:
            raise ValueError("竞品或模板不存在")
        if template.frozen_at is None:
            raise ValueError("模板未冻结，请先冻结模板")
        dimensions = json.loads(template.dimensions)
        name = competitor.name
        alias = competitor.alias or ""
        website = (competitor.website or "").strip().rstrip("/")
        tech_focus = competitor.tech_focus or ""
        keywords = competitor.keywords or ""
        org_id = competitor.org_id

    logger.info(
        "product_intel start: competitor=%s template=%s user=%s",
        competitor_id, template_id, user_id,
    )

    # 第一层：搜索发现
    layer1_result = await _layer1_discover(
        name, alias, website, tech_focus, keywords, dimensions
    )

    # 第二层：定向采集
    key_urls = layer1_result.get("key_urls", [])
    crawled_pages = []
    try:
        crawled_pages = await _layer2_fetch(key_urls, competitor_id)
    except Exception as exc:
        logger.error("layer2 failed: %s", exc)

    # 第三层：LLM 综合 + 写入 DB
    result = await _layer3_synthesize(
        competitor, dimensions, org_id, user_id, template_id,
        layer1_result["search_results"],
        layer1_result["sources"],
        crawled_pages,
    )

    logger.info(
        "product_intel done: competitor=%s profile_id=%s",
        competitor_id, result.get("id"),
    )
    return result


# ---------------------------------------------------------------------------
# 第一层：搜索发现
# ---------------------------------------------------------------------------

async def _layer1_discover(
    name: str, alias: str, website: str,
    tech_focus: str, keywords: str, dimensions: list[dict],
) -> dict:
    """搜索发现层：生成查询 → 并行搜索 → 去重分级 → 筛选关键 URL"""
    queries = _build_search_queries(name, alias, website, dimensions)

    searcher = SearchClient()
    all_results: list[dict] = []
    raw_lists = await asyncio.gather(
        *(searcher.search(q["query"], max_results=5, time_range="year") for q in queries),
        return_exceptions=True,
    )
    for r in raw_lists:
        if isinstance(r, list):
            all_results.extend(r)

    # 去重
    deduped = dedup_by_content(all_results)

    # 分级 + 评分
    comp_names = [n for n in [name, alias] if n]
    processed: list[dict] = []
    for r in deduped:
        domain, tier = classify_source(r.get("url", ""), comp_names, name)
        r["domain"] = domain
        r["tier"] = tier
        r["confidence"] = estimate_confidence({**r, "tier": tier})
        processed.append(r)

    processed.sort(key=lambda x: x.get("confidence", 0), reverse=True)

    # 筛选关键 URL（official 且路径匹配高价值模式）
    key_urls = _extract_key_urls(processed, website)

    return {
        "search_results": processed,
        "sources": processed[:20],
        "key_urls": key_urls,
    }


def _build_search_queries(
    name: str, alias: str, website: str, dimensions: list[dict]
) -> list[dict]:
    """生成 3-5 个搜索查询"""
    queries: list[dict] = []
    seen: set[str] = set()

    def add(query: str, focus: str = "", dimension: str = ""):
        q = query.strip()
        if q and q not in seen:
            seen.add(q)
            queries.append({"query": q, "focus": focus, "dimension": dimension})

    add(f"{name} 产品目录 产品线 最新", "产品目录")
    add(f"{name} 最新发布 新品 2024 2025", "最新动态")

    for dim in dimensions:
        field_labels = "、".join(f["label"] for f in dim.get("fields", []))
        add(
            f"{name} {dim['label']} {field_labels}",
            focus=dim["label"], dimension=dim.get("key", ""),
        )

    if website:
        add(f"site:{website} products pricing", "官网页面")
    add(f"{name} 产品型号 规格参数 价格", "产品参数")

    return queries[:5]


def _extract_key_urls(results: list[dict], website: str) -> list[str]:
    """从搜索结果中筛选高价值 URL（official 且路径匹配）"""
    candidates = []
    for r in results:
        url = (r.get("url") or "").strip()
        if not url:
            continue
        if r.get("tier") != "official":
            continue
        if _KEY_URL_RE.search(urlparse(url).path):
            candidates.append(url)
        if website and urlparse(url).netloc == urlparse(website).netloc:
            if url not in candidates:
                candidates.append(url)
    seen: set[str] = set()
    unique: list[str] = []
    for u in candidates:
        try:
            u = normalize_and_validate_url(u)
        except ValueError:
            continue
        if u not in seen:
            seen.add(u)
            unique.append(u)
    return unique[:_MAX_KEY_URLS]


# ---------------------------------------------------------------------------
# 第二层：定向采集
# ---------------------------------------------------------------------------

async def _layer2_fetch(key_urls: list[str], competitor_id: str) -> list[dict]:
    """定向采集层：对高价值 URL 做轻量抓取，存入 CompetitorPage"""
    if not key_urls:
        return []

    semaphore = asyncio.Semaphore(_MAX_CONCURRENT_CRAWLS)

    async def _fetch(url: str):
        async with semaphore:
            return await _fetch_single_page(url, competitor_id)

    raw = await asyncio.gather(*[_fetch(u) for u in key_urls], return_exceptions=True)
    pages: list[dict] = []
    for r in raw:
        if isinstance(r, dict):
            pages.append(r)
        else:
            logger.warning("layer2 fetch error: %s", r)
    return pages


async def _fetch_single_page(url: str, competitor_id: str) -> dict:
    """定向抓取单个页面（轻量 httpx + readability，截断 5000 chars）"""
    result: dict = {
        "url": url,
        "title": "",
        "content_text": "",
        "content_html": "",
        "page_type": _page_type_from_url(url),
        "access_status": "failed",
        "access_error": "",
    }

    html = ""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await safe_external_request(client, "GET", url, headers={"User-Agent": _USER_AGENT})
            resp.raise_for_status()
            html = resp.text[:500_000]
    except Exception as exc:
        logger.warning("fetch_single_page failed for %s: %s", url, exc)
        result["access_error"] = str(exc)[:500]
        return result

    # 正文提取（readability + BS4 降级）
    try:
        doc = Document(html)
        content_html = doc.summary()
        soup = BeautifulSoup(content_html, "html.parser")
        content_text = soup.get_text(separator="\n", strip=True)
        title = doc.short_title() or _extract_title_fallback(html)
    except Exception:
        soup = BeautifulSoup(html, "html.parser")
        content_text = soup.get_text(separator="\n", strip=True)
        content_html = ""
        title = _extract_title_fallback(html)

    content_text = content_text[:_MAX_CRAWLED_CHARS]
    content_html = content_html[:200_000]
    title = title[:500]

    # 轻量过滤
    if len(content_text) < _MIN_CONTENT_CHARS:
        result.update({
            "title": title,
            "content_text": content_text,
            "access_status": "skipped",
            "access_error": f"content too short: {len(content_text)} chars",
        })
        return result

    result.update({
        "title": title,
        "content_text": content_text,
        "content_html": content_html,
        "access_status": "success",
    })

    # 存入 CompetitorPage（带 SQLite 锁重试）
    try:
        _db_write_retry(lambda: _store_page(competitor_id, result))
        result.setdefault("id", "ok")
    except Exception as exc:
        logger.warning("store CompetitorPage failed for %s: %s", url, exc)

    return result


def _store_page(competitor_id: str, page_data: dict) -> None:
    """在独立 Session 中写入 CompetitorPage"""
    with SessionLocal() as db:
        cp = CompetitorPage(
            competitor_id=competitor_id,
            url=page_data["url"],
            page_type=page_data["page_type"],
            title=page_data["title"],
            content_text=page_data["content_text"],
            content_html=page_data["content_html"],
            access_status="success",
        )
        db.add(cp)
        db.commit()
        db.refresh(cp)
        page_data["id"] = cp.id


def _page_type_from_url(url: str) -> str:
    """根据 URL 推断页面类型（去掉语言前缀后分类）"""
    parsed = urlparse(url)
    path = re.sub(
        r"^/(cn|en|de|fr|ja|ko|es|pt|it|ru|zh)/", "/", parsed.path
    ).lower().rstrip("/")
    segment = path.split("/")[1] if "/" in path else path
    segment = segment.split(".")[0]
    type_map = {
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
    return type_map.get(segment, "other")


def _extract_title_fallback(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find("meta", property="og:title")
    if tag and tag.get("content"):
        return tag["content"].strip()
    tag = soup.find("title")
    if tag:
        return tag.get_text(strip=True)
    return ""


# ---------------------------------------------------------------------------
# 第三层：LLM 综合
# ---------------------------------------------------------------------------

async def _layer3_synthesize(
    competitor: Competitor,
    dimensions: list[dict],
    org_id: str,
    user_id: str,
    template_id: str,
    search_results: list[dict],
    sources: list[dict],
    crawled_pages: list[dict],
) -> dict:
    """LLM 综合层：两次调用 → 合并 → 写入 CompetitorProfile"""
    llm = LLMClient(user_id=user_id, org_id=org_id)
    name = competitor.name
    alias = competitor.alias or ""
    website = competitor.website or ""
    tech_focus = competitor.tech_focus or ""

    dim_desc = "\n".join(
        f"【{dim['label']}】字段："
        + "、".join(f"{f['label']}（{f['type']}）" for f in dim.get("fields", []))
        for dim in dimensions
    )

    search_materials = _format_search_results(search_results, sources)

    # --- 调用 1：广度综合（search-only） ---
    broad_system = (
        _date_header()
        + "你是一名竞争情报分析师。基于给出的网络检索材料，"
        "为竞品提取产品目录、产品线分类和最新动态。\n\n"
        f"竞品：{name}\n别名：{alias}\n官网：{website}\n技术领域：{tech_focus}\n\n"
        f"需要提取的维度：\n{dim_desc}\n\n"
        f"检索材料（共 {_count_materials(search_results, sources)} 条）：\n{search_materials}\n\n"
        "输出 JSON：\n"
        '{"product_catalog": {"product_lines": [{"name": "...", "category": "...", '
        '"description": "...", "confidence": "high|medium|low"}], '
        '"total_products": "...", "categories": ["..."], '
        '"latest_releases": [{"name": "...", "date": "...", '
        '"description": "...", "confidence": "high|medium|low"}]}, '
        '"summary": "100字以内", "info_gaps": ["..."]}\n\n'
        "要求：\n"
        "1. 仅依据材料中的信息，材料未覆盖的内容要明确标注「信息不足」；\n"
        "2. 每个条目标注来源编号 [n]；\n"
        "3. 最新动态只包含有明确时间依据的事件。"
    )
    broad_user = f"竞品：{name}\n\n检索材料：\n{search_materials}"

    broad_data: dict = {}
    try:
        broad_data = await llm.chat_json(broad_system, broad_user)
    except Exception as exc:
        logger.error("LLM broad call failed: %s", exc)
        broad_data = {}

    # --- 调用 2：深度提取（search + crawl） ---
    crawled_text = _format_crawled_pages(crawled_pages)
    deep_system = (
        _date_header()
        + "你是一名竞争情报分析师。基于给出的网络检索材料"
        "（含搜索引擎结果和官网定向抓取内容），"
        "为竞品提取精确的产品参数和定价信息。\n\n"
        f"竞品：{name}\n别名：{alias}\n官网：{website}\n\n"
        f"需要提取的维度：\n{dim_desc}\n\n"
        f"检索材料：\n{search_materials}\n\n"
        f"官网页面内容（已定向抓取）：\n{crawled_text}\n\n"
        "输出 JSON：\n"
        '{"dimensions": {"product_specs": {"specs_by_product": [{"name": "...", '
        '"specs": {"参数名": {"value": "...", "confidence": "high|medium|low", '
        '"source_urls": ["..."]}}}], "key_specs": {...}}, '
        '"pricing": {"price_list": [{"product": "...", "price": "¥X,XXX", '
        '"confidence": "high|medium|low", "source_urls": ["..."]}], '
        '"price_range": "...", "pricing_model": "..."}}, '
        '"summary": "...", "overall_confidence": "high|medium|low", '
        '"info_gaps": ["..."]}\n\n'
        "要求：\n"
        "1. 精确参数以官网抓取内容为准，搜索结果为辅；\n"
        "2. 定价信息以官网定价页为准；\n"
        "3. 多来源冲突时标注「存在差异：A来源说X，B来源说Y」；\n"
        "4. 不能编造信息，不确定的内容明确标注。"
    )
    deep_user = (
        f"竞品：{name}\n\n检索材料：\n{search_materials}\n\n"
        f"官网页面内容：\n{crawled_text}"
    )

    deep_data: dict = {}
    try:
        deep_data = await llm.chat_json(deep_system, deep_user)
    except Exception as exc:
        logger.error("LLM deep call failed: %s", exc)
        deep_data = {"info_gaps": [f"深度提取失败：{exc}"]}

    # 合并输出
    merged = _merge_results(broad_data, deep_data, dimensions)

    # 新增：归一化维度字段值格式 + 写入 dimension_labels
    from app.services.profile_extractor import _normalize_dimensions
    dim_label_map = {d["key"]: d["label"] for d in dimensions}
    merged["dimensions"] = _normalize_dimensions(
        merged.get("dimensions", {}),
        dim_label_map,
    )
    merged["dimension_labels"] = dim_label_map

    # 来源引用
    source_refs = _build_source_refs(search_results, crawled_pages)

    # 写入 CompetitorProfile（带 SQLite 锁重试）
    profile = None
    def _insert():
        nonlocal profile
        with SessionLocal() as db:
            profile = CompetitorProfile(
                org_id=org_id,
                user_id=user_id,
                competitor_id=competitor.id,
                template_id=template_id,
                template_version=template.version,
                profile_data=json.dumps(merged, ensure_ascii=False),
                source_refs=json.dumps(source_refs, ensure_ascii=False),
                status="draft",
                generation_source="product_intel",
            )
            db.add(profile)
            db.commit()
            db.refresh(profile)

    _db_write_retry(_insert)

    profile_data_out = (
        json.loads(profile.profile_data)
        if isinstance(profile.profile_data, str)
        else profile.profile_data
    )
    source_refs_out = (
        json.loads(profile.source_refs)
        if isinstance(profile.source_refs, str)
        else profile.source_refs
    )

    return {
        "id": profile.id,
        "status": profile.status,
        "profile_data": profile_data_out,
        "source_refs": source_refs_out,
        "generation_source": "product_intel",
    }


# ---------------------------------------------------------------------------
# DB 写入重试（应对 SQLite 并发锁）
# ---------------------------------------------------------------------------

def _db_write_retry(fn, retries: int = 5, delay: float = 3.0):
    last_err = None
    for attempt in range(retries):
        try:
            fn()
            return
        except Exception as exc:
            last_err = exc
            if "database is locked" in str(exc) and attempt < retries - 1:
                logger.warning("DB locked, retry %d/%d in %.0fs", attempt + 1, retries - 1, delay)
                time.sleep(delay)
            else:
                raise
    raise last_err


# ---------------------------------------------------------------------------
# 格式化 / 合并辅助
# ---------------------------------------------------------------------------

def _count_materials(search_results: list[dict], sources: list[dict]) -> int:
    return min(len(search_results) or len(sources), 20)


def _format_search_results(search_results: list[dict], sources: list[dict]) -> str:
    data = search_results if search_results else sources
    if not data:
        return "（无检索材料）"
    lines = []
    for i, r in enumerate(data[:20], 1):
        title = r.get("title", "(无标题)")
        url = r.get("url", "")
        snippet = (r.get("content", "") or r.get("snippet", "") or "")[:300]
        confidence = r.get("confidence", 0.0)
        tier = r.get("tier", "other")
        lines.append(
            f"[{i}] {title}\nURL: {url}\n来源类型: {tier} | 置信度: {confidence:.2f}\n内容: {snippet}"
        )
    return "\n\n".join(lines)


def _format_crawled_pages(pages: list[dict]) -> str:
    if not pages:
        return "（无官网页面内容）"
    lines = []
    for p in pages:
        if p.get("access_status") != "success":
            continue
        title = p.get("title", "")
        url = p.get("url", "")
        text = (p.get("content_text", "") or "")[:3000]
        lines.append(f"=== 页面：{title}\nURL: {url}\n{text}")
    return "\n\n".join(lines) if lines else "（无可用官网页面内容）"


def _merge_results(broad: dict, deep: dict, dimensions: list[dict]) -> dict:
    """合并两层 LLM 输出为统一的 dimensions 结构"""
    merged: dict = {"dimensions": {}}

    if "product_catalog" in broad:
        merged["dimensions"]["product_catalog"] = broad["product_catalog"]
    if "summary" in broad:
        merged["summary"] = broad["summary"]
    gaps = broad.get("info_gaps", [])
    if isinstance(gaps, list):
        merged.setdefault("info_gaps", [])
        merged["info_gaps"].extend(gaps)

    if "dimensions" in deep:
        for key, val in deep["dimensions"].items():
            merged["dimensions"][key] = val

    for key in ("product_specs", "pricing"):
        if key in deep:
            merged["dimensions"][key] = deep[key]

    if "summary" in deep:
        merged["summary"] = deep["summary"]
    if "overall_confidence" in deep:
        merged["overall_confidence"] = deep["overall_confidence"]
    gaps2 = deep.get("info_gaps", [])
    if isinstance(gaps2, list):
        merged.setdefault("info_gaps", [])
        merged["info_gaps"].extend(gaps2)

    merged["info_gaps"] = list(dict.fromkeys(merged.get("info_gaps", [])))

    for dim in dimensions:
        key = dim.get("key", "")
        if key and key not in merged["dimensions"]:
            merged["dimensions"][key] = {"_info": "信息不足"}

    return merged


def _build_source_refs(search_results: list[dict], crawled_pages: list[dict]) -> list[dict]:
    """构建来源引用列表"""
    refs: list[dict] = []
    for r in search_results[:20]:
        refs.append({
            "url": r.get("url", ""),
            "title": r.get("title", ""),
            "snippet": (r.get("content", "") or "")[:200],
            "source_type": "search",
            "confidence": float(r.get("confidence", 0.0) or 0.0),
        })
    for p in crawled_pages:
        if p.get("access_status") == "success":
            refs.append({
                "url": p.get("url", ""),
                "title": p.get("title", ""),
                "snippet": (p.get("content_text", "") or "")[:200],
                "source_type": "crawl",
                "confidence": 0.8,
            })
    return refs

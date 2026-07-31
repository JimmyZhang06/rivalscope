"""竞品调研 Agent 编排：规划 -> 检索 -> 分析 -> 洞察 -> 报告

任务在后台异步执行，每一步都写入数据库（TaskStep），
前端通过 SSE 轮询数据库获取实时进度。
"""

import asyncio
import json
import logging
import re
from urllib.parse import urlparse

from app.core.config import get_settings
from app.core.timeutil import age_days_of, baseline_now, parse_published, recency_weight
from app.db.database import SessionLocal
from app.db.models import ResearchTask, Source, TaskStep

logger = logging.getLogger(__name__)

MAX_QUERIES = 8  # 单次调研最多执行的搜索次数
MAX_RESULTS_PER_QUERY = 5
SNIPPET_LIMIT = 1000  # 每条检索材料送入 LLM 的最大字符数
RAW_CONTENT_LIMIT = 8000  # 原文摘录入库的最大字符数
RECENCY_HALF_LIFE_DAYS = 180  # 时间衰减半衰期


def _date_header() -> str:
    """所有 system prompt 头部注入的当前日期声明，让模型具备时间意识。"""
    return (
        f"【当前日期：{baseline_now():%Y-%m-%d}】"
        "请以此为“今天”判断信息的时效性，优先采信近期信息，"
        "对明显过时的旧信息保持谨慎并在必要时说明其时间。\n"
    )

# 来源分级用的域名清单（启发式，无需穷举）
MEDIA_DOMAINS = (
    "36kr.com", "techcrunch.com", "ifanr.com", "sspai.com", "theverge.com",
    "geekpark.net", "leiphone.com", "qbitai.com", "jiqizhixin.com", "pingwest.com",
    "wired.com", "forbes.com", "bloomberg.com", "reuters.com", "cnbeta.com",
    "engadget.com", "zdnet.com", "cnet.com", "venturebeat.com", "sina.com.cn",
    "163.com", "qq.com", "sohu.com", "thepaper.cn", "infoq.cn", "csdn.net",
)
COMMUNITY_DOMAINS = (
    "zhihu.com", "reddit.com", "github.com", "v2ex.com", "producthunt.com",
    "g2.com", "capterra.com", "trustpilot.com", "juejin.cn", "segmentfault.com",
    "stackoverflow.com", "news.ycombinator.com", "douban.com", "xiaohongshu.com",
    "bilibili.com", "medium.com", "quora.com", "slant.co", "getapp.com",
)


def classify_source(url: str, competitors: list[str], product_name: str = "") -> tuple[str, str]:
    """按域名启发式分级来源，返回 (domain, tier)"""
    try:
        domain = (urlparse(url).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return "", "other"
    if not domain:
        return "", "other"

    def norm(name: str) -> str:
        # 归一化产品名用于域名匹配：去空格与常见符号，转小写
        return re.sub(r"[^a-z0-9]", "", name.lower())

    names = [norm(c) for c in [*competitors, product_name] if norm(c)]
    domain_key = norm(domain.split(".")[0])
    if domain_key and any(domain_key == n or (len(n) >= 4 and n in domain_key) for n in names):
        return domain, "official"
    if any(domain == d or domain.endswith("." + d) for d in MEDIA_DOMAINS):
        return domain, "media"
    if any(domain == d or domain.endswith("." + d) for d in COMMUNITY_DOMAINS):
        return domain, "community"
    return domain, "other"


# ---------------------------------------------------------------------------
# 数据库辅助：后台任务中使用独立的短生命周期会话
# ---------------------------------------------------------------------------

def _update_status(task_id: str, status: str, error: str = "") -> None:
    with SessionLocal() as db:
        task = db.get(ResearchTask, task_id)
        if task:
            task.status = status
            if error:
                task.error = error
            db.commit()


def _add_step(task_id: str, phase: str, title: str, detail: str = "") -> None:
    with SessionLocal() as db:
        seq = db.query(TaskStep).filter(TaskStep.task_id == task_id).count() + 1
        db.add(TaskStep(task_id=task_id, seq=seq, phase=phase, title=title, detail=detail))
        db.commit()


def _save_sources(task_id: str, results: list[dict]) -> None:
    with SessionLocal() as db:
        for r in results:
            raw_pub = str(r.get("published_date") or "")
            parsed = parse_published(raw_pub)
            published_at = parsed.strftime("%Y-%m-%d") if parsed else raw_pub[:50]
            db.add(
                Source(
                    task_id=task_id,
                    title=r["title"][:500],
                    url=r["url"][:1000],
                    snippet=r["content"][:2000],
                    score=round(float(r.get("score") or 0.0), 4),
                    domain=r.get("domain", "")[:255],
                    tier=r.get("tier", "other"),
                    published_at=published_at,
                    dimension=str(r.get("dimension") or "")[:100],
                    raw_content=str(r.get("raw_content") or "")[:RAW_CONTENT_LIMIT],
                )
            )
        db.commit()


def _save_insights(task_id: str, data: dict) -> None:
    with SessionLocal() as db:
        task = db.get(ResearchTask, task_id)
        if task:
            task.report_data = json.dumps(data, ensure_ascii=False)
            db.commit()


def _merge_report_data(task_id: str, patch: dict) -> None:
    """把补充数据合并进 report_data（保留已有洞察，不覆盖）。"""
    with SessionLocal() as db:
        task = db.get(ResearchTask, task_id)
        if not task:
            return
        try:
            existing = json.loads(task.report_data) if task.report_data else {}
            if not isinstance(existing, dict):
                existing = {}
        except (ValueError, TypeError):
            existing = {}
        existing.update(patch)
        task.report_data = json.dumps(existing, ensure_ascii=False)
        db.commit()


def _save_report(task_id: str, markdown: str) -> None:
    with SessionLocal() as db:
        task = db.get(ResearchTask, task_id)
        if task:
            task.report_markdown = markdown
            task.status = "completed"
            db.commit()


# ---------------------------------------------------------------------------
# Agent 各阶段
# ---------------------------------------------------------------------------

async def _plan(llm, task: ResearchTask, max_queries: int) -> dict:
    """阶段一：生成竞品清单与搜索关键词"""
    system = (
        _date_header()
        + "你是一名资深的市场竞品分析师。用户会给出一个产品/公司名称，"
        "你需要规划一次竞品调研：确定要对比的竞品（如果用户已指定则以用户为准，可适当补充），"
        "并针对产品功能、定价策略、目标市场、用户评价、最新动态等维度设计搜索关键词。\n"
        "输出 JSON，格式：\n"
        '{"competitors": ["竞品1", "竞品2"], '
        '"queries": [{"dimension": "维度名", "query": "搜索关键词"}]}\n'
        f"queries 不超过 {max_queries} 条，搜索关键词要具体、适合搜索引擎检索；"
        "涉及动态、行情、财报、发布等时效性内容的检索词应体现时效（如带上当前年份或“最新”等），"
        "以便检索到最新信息。"
    )
    user = f"调研对象：{task.product_name}"
    if task.competitors:
        user += f"\n用户指定的竞品：{task.competitors}"
    if task.focus:
        user += f"\n调研重点：{task.focus}"
    plan = await llm.chat_json(system, user)
    if not isinstance(plan.get("queries"), list) or not plan["queries"]:
        raise ValueError("LLM 未能生成有效的搜索规划")
    plan["queries"] = plan["queries"][:max_queries]
    return plan


async def _search_all(searcher, task_id: str, queries: list[dict], time_range: str = "") -> list[dict]:
    """阶段二：并发执行搜索并按 URL 去重，每条结果带上所属检索维度"""

    async def one(q: dict) -> list[dict]:
        query = str(q.get("query", "")).strip()
        dimension = str(q.get("dimension", "")).strip()
        if not query:
            return []
        try:
            results = await searcher.search(
                query, max_results=MAX_RESULTS_PER_QUERY, time_range=time_range
            )
            for r in results:
                r["dimension"] = dimension
            _add_step(task_id, "searching", f"检索「{query}」", f"获取到 {len(results)} 条结果")
            return results
        except Exception as exc:  # 单条搜索失败不中断整体流程
            logger.warning("search failed for %r: %s", query, exc)
            _add_step(task_id, "searching", f"检索「{query}」失败", str(exc)[:300])
            return []

    grouped = await asyncio.gather(*(one(q) for q in queries))
    seen: set[str] = set()
    merged: list[dict] = []
    for results in grouped:
        for r in results:
            if r["url"] and r["url"] not in seen:
                seen.add(r["url"])
                merged.append(r)
    return merged


TIER_NAMES = {"official": "官方", "media": "媒体", "community": "社区", "other": "其他"}


def _build_materials(results: list[dict]) -> str:
    """按检索维度分组构建材料清单，编号与入库顺序一致（即前端来源列表顺序）"""
    now = baseline_now()
    by_dim: dict[str, list[tuple[int, dict]]] = {}
    for i, r in enumerate(results, 1):
        by_dim.setdefault(r.get("dimension") or "综合", []).append((i, r))
    lines = []
    for dim, items in by_dim.items():
        lines.append(f"### 维度：{dim}")
        for i, r in items:
            meta = f"来源类型: {TIER_NAMES.get(r.get('tier', 'other'), '其他')}"
            if r.get("published_date"):
                meta += f" | 发布时间: {r['published_date']}"
                age = age_days_of(parse_published(r.get("published_date")), now)
                if age >= 0:
                    meta += f" | 距今 {age} 天"
            lines.append(f"[{i}] {r['title']}\nURL: {r['url']}\n{meta}\n内容: {r['content'][:SNIPPET_LIMIT]}\n")
    return "\n".join(lines)


def _credibility_summary(results: list[dict], queries: list[dict]) -> str:
    """程序化统计来源构成，供报告的可信度说明章节使用"""
    now = baseline_now()
    tier_count: dict[str, int] = {}
    for r in results:
        tier_count[r.get("tier", "other")] = tier_count.get(r.get("tier", "other"), 0) + 1
    tier_text = "、".join(f"{TIER_NAMES[t]} {n} 条" for t, n in sorted(tier_count.items(), key=lambda x: -x[1]))
    dates = sorted(d for d in (str(r.get("published_date") or "")[:10] for r in results) if d)
    time_span = f"{dates[0]} ~ {dates[-1]}" if dates else "多数来源未提供发布时间"
    # 新鲜度分布
    buckets = {"≤30天": 0, "≤180天": 0, "≤365天": 0, "更早": 0, "无日期": 0}
    for r in results:
        age = age_days_of(parse_published(r.get("published_date")), now)
        if age < 0:
            buckets["无日期"] += 1
        elif age <= 30:
            buckets["≤30天"] += 1
        elif age <= 180:
            buckets["≤180天"] += 1
        elif age <= 365:
            buckets["≤365天"] += 1
        else:
            buckets["更早"] += 1
    fresh_text = "、".join(f"{k} {v} 条" for k, v in buckets.items() if v)
    dims = "、".join(dict.fromkeys(str(q.get("dimension", "")).strip() for q in queries if q.get("dimension")))
    return (
        f"共收集 {len(results)} 条信息来源，构成：{tier_text}。\n"
        f"来源发布时间跨度：{time_span}。\n"
        f"信息新鲜度分布（基准 {now:%Y-%m-%d}）：{fresh_text}。\n"
        f"检索覆盖维度：{dims or '综合'}。"
    )


async def _analyze(llm, task: ResearchTask, competitors: list[str], materials: str) -> str:
    """阶段三：按维度提炼检索材料"""
    system = (
        _date_header()
        + "你是一名资深的市场竞品分析师。基于给出的网络检索材料（已按调研维度分组，含来源类型、发布时间与距今天数），"
        "围绕以下维度进行客观分析：产品概况、核心功能对比、定价策略、目标市场与用户群、各自优劣势。\n"
        "硬性要求：\n"
        "1. 只依据材料中的信息，材料未覆盖的内容要明确说明信息不足，不得编造；\n"
        "2. 每一条具体论断（数据、功能、价格、评价等）后面必须紧跟支持它的材料编号，如 [3] 或 [3][7]；\n"
        "3. 优先采信官方与媒体来源，社区来源用于口碑与用户反馈，观点冲突时并列说明并标注各自出处；\n"
        "4. 注意信息时效：优先采用近期材料，引用较旧信息（距今较久）时说明其时间背景，避免把过时结论当作现状。"
    )
    user = (
        f"调研对象：{task.product_name}\n"
        f"竞品：{'、'.join(competitors) if competitors else '（未指定）'}\n"
        + (f"调研重点：{task.focus}\n" if task.focus else "")
        + f"\n检索材料：\n{materials}"
    )
    return await llm.chat(system, user)


async def _insights(llm, task: ResearchTask, competitors: list[str], analysis: str) -> dict:
    """阶段四：产出结构化数据洞察（评分/SWOT/结论），供前端图表渲染"""
    subjects = [task.product_name] + [c for c in competitors if c != task.product_name]
    system = (
        _date_header()
        + "你是一名资深的市场竞品分析师。基于给出的分析内容，输出结构化的量化洞察 JSON：\n"
        '{"dimensions": ["功能完备性", "定价竞争力", "用户口碑", "市场声量", "发展潜力"],\n'
        ' "competitors": [{"name": "产品名", "scores": {"功能完备性": 8, "定价竞争力": 7, "用户口碑": 8, "市场声量": 9, "发展潜力": 8}, "positioning": "一句话定位"}],\n'
        ' "swot": {"strengths": ["..."], "weaknesses": ["..."], "opportunities": ["..."], "threats": ["..."]},\n'
        ' "verdict": "总体结论一句话"}\n'
        "要求：\n"
        "1. dimensions 固定使用上述 5 个维度；每个产品每个维度打 1-10 的整数分，评分必须能从分析内容中找到依据，"
        "信息不足的维度给保守中间分（5-6）；\n"
        "2. competitors 数组必须包含调研对象本身和所有竞品；positioning 是基于分析的一句话市场定位；\n"
        "3. swot 针对调研对象本身，每项 2-4 条，简洁短句；\n"
        "4. verdict 是对调研对象竞争态势的一句话总结。"
    )
    user = (
        f"调研对象：{task.product_name}\n"
        f"需要评分的产品：{'、'.join(subjects)}\n\n"
        f"分析内容：\n{analysis}"
    )
    data = await llm.chat_json(system, user)
    # 基本形状校验，缺失关键字段则视为洞察失败（不阻断整体流程）
    if not isinstance(data.get("competitors"), list) or not data["competitors"]:
        raise ValueError("洞察数据缺少 competitors")
    if not isinstance(data.get("dimensions"), list) or not data["dimensions"]:
        data["dimensions"] = ["功能完备性", "定价竞争力", "用户口碑", "市场声量", "发展潜力"]
    return data


async def _report(
    llm, task: ResearchTask, competitors: list[str], analysis: str, results: list[dict], credibility: str
) -> str:
    """阶段五：生成最终 Markdown 调研报告"""
    source_list = "\n".join(f"[{i}] {r['title']} - {r['url']}" for i, r in enumerate(results, 1))
    system = (
        _date_header()
        + "你是一名资深的市场竞品分析师。请把分析内容整理成一份结构化的 Markdown 竞品调研报告，包含：\n"
        "1. 执行摘要\n2. 调研对象与竞品概况\n3. 核心功能对比（用 Markdown 表格）\n"
        "4. 定价策略对比\n5. 目标市场与用户群\n6. SWOT 分析\n7. 结论与建议\n"
        "8. 可信度说明\n9. 信息来源（沿用给出的编号与链接）\n"
        "硬性要求：\n"
        "- 保留分析内容中的 [n] 引用标注，正文论断处直接写 [n] 纯文本，不要写成 Markdown 链接；\n"
        "- 「可信度说明」章节：先原样呈现给出的来源统计数据，再补充 2-4 条本次调研的信息缺口与局限性"
        "（如某维度材料不足、来源时效性、单一来源论断等）；\n"
        "- 报告使用中文，直接输出 Markdown 正文，不要用代码块包裹。"
    )
    user = (
        f"调研对象：{task.product_name}\n"
        f"竞品：{'、'.join(competitors) if competitors else '（未指定）'}\n\n"
        f"分析内容：\n{analysis}\n\n"
        f"来源统计数据（用于可信度说明章节）：\n{credibility}\n\n"
        f"信息来源列表：\n{source_list}"
    )
    return await llm.chat(system, user, temperature=0.4)


def _normalize_timeline(raw) -> list[dict]:
    """规范化时间线条目：校验字段、按日期降序、限量。"""
    items: list[dict] = []
    if not isinstance(raw, list):
        return items
    for it in raw:
        if not isinstance(it, dict):
            continue
        date = str(it.get("date", "")).strip()[:20]
        title = str(it.get("title", "")).strip()[:200]
        if not date or not title:
            continue
        ref = it.get("ref")
        try:
            ref = int(ref)
        except (TypeError, ValueError):
            ref = None
        items.append({
            "date": date,
            "title": title,
            "summary": str(it.get("summary", "")).strip()[:500],
            "ref": ref,
        })
    items.sort(key=lambda x: x["date"], reverse=True)
    return items[:12]


async def _timeline(llm, task: ResearchTask, analysis: str, materials: str) -> list[dict]:
    """非阻断步骤：抽取与调研对象相关的关键事件时间线。"""
    system = (
        _date_header()
        + "你是一名情报分析师。基于分析内容与检索材料，抽取与调研对象相关的关键事件（发布、融资、合作、"
        "人事、财报、政策等），按时间排列，输出 JSON：\n"
        '{"timeline": [{"date": "YYYY-MM-DD 或 YYYY-MM", "title": "事件标题", "summary": "一句话说明", "ref": 3}]}\n'
        "要求：\n"
        "1. 只抽取材料中有明确时间依据的事件，不得编造日期；\n"
        "2. 每个事件尽量给出 ref（对应材料编号 [n]）作为依据；\n"
        "3. 事件不超过 12 条，date 尽量精确到日，无法精确到日时给到月；\n"
        "4. 优先近期与重要事件。"
    )
    user = (
        f"调研对象：{task.product_name}\n\n"
        f"分析内容：\n{analysis}\n\n"
        f"检索材料：\n{materials}"
    )
    data = await llm.chat_json(system, user)
    return _normalize_timeline(data.get("timeline") if isinstance(data, dict) else None)


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

async def run_research(task_id: str) -> None:
    """后台执行完整调研流程"""
    settings = get_settings()
    missing = []
    if not settings.llm_api_key or settings.llm_api_key == "your-llm-api-key":
        missing.append("LLM_API_KEY")
    if not settings.llm_base_url:
        missing.append("LLM_BASE_URL")
    if not settings.tavily_api_key or settings.tavily_api_key == "your-tavily-api-key":
        missing.append("TAVILY_API_KEY")
    if missing:
        msg = f"缺少配置项 {', '.join(missing)}，请在 backend/.env 中填写（参考 .env.example）"
        _add_step(task_id, "error", "配置检查失败", msg)
        _update_status(task_id, "failed", msg)
        return

    from app.services.llm import LLMClient
    from app.services.search import SearchClient

    llm = LLMClient()
    searcher = SearchClient()

    with SessionLocal() as db:
        task = db.get(ResearchTask, task_id)
        if not task:
            return
        # 按任务归属用户的会员等级确定检索关键词组数（入企用户按企业套餐）
        from app.core.plans import effective_org_plan, effective_plan, plan_limits
        from app.db.models import Organization, User

        owner = db.get(User, task.user_id)
        if owner:
            org = db.get(Organization, owner.org_id) if owner.org_id else None
            plan = effective_org_plan(org) if org and owner.role != "admin" else effective_plan(owner)
            max_queries = plan_limits(plan)["max_queries"]
        else:
            max_queries = MAX_QUERIES
        db.expunge(task)  # 后续只读使用

    try:
        # 1. 规划
        _update_status(task_id, "planning")
        _add_step(task_id, "planning", "开始规划调研方案", "分析调研对象，确定竞品与搜索策略")
        plan = await _plan(llm, task, max_queries)
        competitors = [str(c) for c in plan.get("competitors", [])]
        queries = plan["queries"]
        _add_step(
            task_id,
            "planning",
            "调研方案已生成",
            f"竞品：{'、'.join(competitors) or '（无）'}\n"
            + "搜索计划：\n"
            + "\n".join(f"- [{q.get('dimension', '')}] {q.get('query', '')}" for q in queries),
        )

        # 2. 检索
        _update_status(task_id, "searching")
        time_range = (getattr(task, "time_range", "") or "").strip()
        _add_step(task_id, "searching", "开始联网检索", f"共 {len(queries)} 组搜索关键词")
        results = await _search_all(searcher, task_id, queries, time_range=time_range)
        if not results:
            raise ValueError("联网检索未获取到任何结果，请检查 TAVILY_API_KEY 或稍后重试")
        # 来源分级
        for r in results:
            r["domain"], r["tier"] = classify_source(r["url"], competitors, task.product_name)
        # 综合排序：Tavily 相关度 0.6 + 时间新鲜度 0.4，使 [n] 编号反映优先级
        now = baseline_now()
        for r in results:
            recency = recency_weight(parse_published(r.get("published_date")), now, RECENCY_HALF_LIFE_DAYS)
            r["combined"] = 0.6 * float(r.get("score") or 0.0) + 0.4 * recency
        results.sort(key=lambda r: r.get("combined", 0.0), reverse=True)
        _save_sources(task_id, results)
        credibility = _credibility_summary(results, queries)
        _add_step(task_id, "searching", "检索完成", f"去重后共收集 {len(results)} 条信息来源\n{credibility}")

        # 3. 分析
        _update_status(task_id, "analyzing")
        _add_step(task_id, "analyzing", "开始分析检索材料", "按功能、定价、市场、优劣势等维度提炼，逐条标注引用")
        materials = _build_materials(results)
        analysis = await _analyze(llm, task, competitors, materials)
        _add_step(task_id, "analyzing", "维度分析完成")

        # 4. 数据洞察（失败不阻断报告生成）
        _add_step(task_id, "analyzing", "生成数据洞察", "量化竞品评分、SWOT 与结论，用于可视化图表")
        try:
            insights = await _insights(llm, task, competitors, analysis)
            _save_insights(task_id, insights)
            _add_step(task_id, "analyzing", "数据洞察已生成", f"覆盖 {len(insights['competitors'])} 个产品的多维评分")
        except Exception as exc:
            logger.warning("insights failed for task %s: %s", task_id, exc)
            _add_step(task_id, "analyzing", "数据洞察生成失败（不影响报告）", str(exc)[:300])

        # 4b. 事件时间线（非阻断）
        _add_step(task_id, "analyzing", "构建事件时间线", "抽取关键事件并按时间排列")
        try:
            timeline = await _timeline(llm, task, analysis, materials)
            if timeline:
                _merge_report_data(task_id, {"timeline": timeline})
                _add_step(task_id, "analyzing", "事件时间线已生成", f"共 {len(timeline)} 个关键事件")
            else:
                _add_step(task_id, "analyzing", "未抽取到明确时间线事件（不影响报告）")
        except Exception as exc:
            logger.warning("timeline failed for task %s: %s", task_id, exc)
            _add_step(task_id, "analyzing", "时间线生成失败（不影响报告）", str(exc)[:300])

        # 5. 报告
        _update_status(task_id, "reporting")
        _add_step(task_id, "reporting", "开始生成调研报告")
        report = await _report(llm, task, competitors, analysis, results, credibility)
        _save_report(task_id, report)
        _add_step(task_id, "done", "调研完成", "报告已生成")

        # 6. 定时追踪任务：生成本期变更摘要并推送（失败不影响已完成的报告）
        if task.tracker_id:
            from app.services.digest import generate_change_summary
            from app.services.notify import push_tracker_report

            try:
                await generate_change_summary(llm, task_id)
            except Exception:
                logger.exception("digest failed for task %s", task_id)
            try:
                await push_tracker_report(task_id)
            except Exception:
                logger.exception("push failed for task %s", task_id)
    except Exception as exc:
        logger.exception("research task %s failed", task_id)
        msg = str(exc)[:1000]
        _add_step(task_id, "error", "调研失败", msg)
        _update_status(task_id, "failed", msg)

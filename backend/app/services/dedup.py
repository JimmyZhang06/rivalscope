"""去重、冲突检测与置信度估算服务"""

import logging
from difflib import SequenceMatcher
from urllib.parse import urlparse

from app.core.timeutil import age_days_of, baseline_now, parse_published

logger = logging.getLogger(__name__)

# 来源层级权重
_TIER_WEIGHT = {"official": 0.9, "media": 0.7, "community": 0.4, "other": 0.2}


def estimate_confidence(source: dict) -> float:
    """
    规则评分：来源层级权重 × 新鲜度衰减。

    新鲜度衰减：
      ≤30 天 → 1.0
      ≤180 天 → 0.85
      ≤365 天 → 0.6
      >365 天 → 0.3
      无日期 / 未来日期 → 0.25
    """
    tier_w = _TIER_WEIGHT.get(source.get("tier", "other"), 0.2)
    pub = parse_published(source.get("published_date"))
    age = age_days_of(pub, baseline_now())
    if age < 0:
        freshness = 0.25
    elif age <= 30:
        freshness = 1.0
    elif age <= 180:
        freshness = 0.85
    elif age <= 365:
        freshness = 0.6
    else:
        freshness = 0.3
    return round(tier_w * freshness, 3)


def dedup_by_content(results: list[dict], threshold: float = 0.85) -> list[dict]:
    """
    基于 URL + 标题相似度的去重（纯规则，不依赖 LLM）。

    策略：
    1. URL 完全相同直接去重（保留第一条）
    2. 域名相同 + 标题相似度 > threshold → 标记为重复
    3. 为重复项设置 dedup_group 和 is_duplicate
    """
    seen_urls: dict[str, str] = {}
    dedup_groups: dict[str, str] = {}
    group_counter = 0

    def _group_id() -> str:
        nonlocal group_counter
        group_counter += 1
        return f"g{group_counter:06d}"

    for r in results:
        url = (r.get("url") or "").strip().rstrip("/")
        title = (r.get("title") or "").strip()
        if not url:
            continue

        # URL 完全重复 → 直接去重
        if url in seen_urls:
            r["is_duplicate"] = True
            r["dedup_group"] = seen_urls[url]
            continue

        seen_urls[url] = url

        # 域名相同 + 标题相似 → 去重组
        domain = (urlparse(url).hostname or "").lower().removeprefix("www.")
        for other_url in seen_urls:
            other_domain = (urlparse(other_url).hostname or "").lower().removeprefix("www.")
            if domain and domain == other_domain:
                other_title = ""
                # 找到同 URL 对应的 title
                for item in results:
                    if (item.get("url") or "").strip().rstrip("/") == other_url:
                        other_title = (item.get("title") or "").strip()
                        break
                sim = SequenceMatcher(None, title, other_title).ratio()
                if sim > threshold:
                    gid = dedup_groups.get(other_url, _group_id())
                    dedup_groups[other_url] = gid
                    dedup_groups[url] = gid
                    r["dedup_group"] = gid
                    break

    return results


def detect_conflicts(sources: list[dict], dimensions: list[str]) -> list[dict]:
    """
    检测同一维度内的来源冲突（保守策略：标记 pending，人工复核）。

    当前策略：同一维度内存在多个不同 URL 的来源时标记为待复核。
    """
    conflicts = []
    by_dim: dict[str, list[dict]] = {}
    for s in sources:
        dim = str(s.get("dimension") or "综合")
        by_dim.setdefault(dim, []).append(s)

    for dim, group in by_dim.items():
        if len(group) < 2:
            continue
        urls = {s.get("url", "") for s in group}
        if len(urls) > 1:
            for s in group:
                if s.get("conflict_status") == "none":
                    s["conflict_status"] = "pending"
                    conflicts.append({
                        "dimension": dim,
                        "source_id": s.get("source_id"),
                        "note": f"维度「{dim}」存在多个来源，需人工复核一致性",
                    })
    return conflicts

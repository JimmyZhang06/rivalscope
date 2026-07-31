"""变更摘要：追踪任务完成后，用 LLM 对比上一期报告产出「本期变更」

首期（无上一期 completed 任务）写入基线说明；对比失败不阻断主流程。
"""

import json
import logging

from app.db.database import SessionLocal
from app.db.models import ResearchTask

logger = logging.getLogger(__name__)

REPORT_EXCERPT_LIMIT = 6000  # 送入 LLM 的单期报告最大字符数

BASELINE_TEXT = "本期为首期基线报告，暂无上一期可对比。后续每期将在此展示与上一期的变更内容。"


def _scores_text(report_data: str) -> str:
    """从结构化洞察中提取评分摘要，便于 LLM 对比评分变动"""
    try:
        data = json.loads(report_data)
        lines = []
        for c in data.get("competitors", []):
            scores = "、".join(f"{k} {v}" for k, v in (c.get("scores") or {}).items())
            lines.append(f"- {c.get('name', '')}：{scores}")
        return "\n".join(lines) or "（无评分数据）"
    except (ValueError, AttributeError):
        return "（无评分数据）"


def _previous_task(db, task: ResearchTask) -> ResearchTask | None:
    return (
        db.query(ResearchTask)
        .filter(
            ResearchTask.tracker_id == task.tracker_id,
            ResearchTask.status == "completed",
            ResearchTask.id != task.id,
            ResearchTask.created_at < task.created_at,
        )
        .order_by(ResearchTask.created_at.desc())
        .first()
    )


async def generate_change_summary(llm, task_id: str) -> None:
    """对比本期与上一期报告，写入 task.change_summary"""
    with SessionLocal() as db:
        task = db.get(ResearchTask, task_id)
        if not task or not task.tracker_id:
            return
        prev = _previous_task(db, task)
        if not prev:
            task.change_summary = BASELINE_TEXT
            db.commit()
            return
        cur_report = task.report_markdown[:REPORT_EXCERPT_LIMIT]
        cur_scores = _scores_text(task.report_data)
        prev_report = prev.report_markdown[:REPORT_EXCERPT_LIMIT]
        prev_scores = _scores_text(prev.report_data)
        prev_date = prev.created_at.strftime("%Y-%m-%d")
        product_name = task.product_name

    system = (
        "你是一名资深的市场竞品分析师，负责定期追踪目标产品的动态。"
        "下面给出同一调研对象上一期与本期的调研报告（含各维度评分），"
        "请对比两期内容，产出「本期变更」摘要，Markdown 格式，固定包含四个小节：\n"
        "### 产品更新\n### 策略变化\n### 评分变动\n### 新增信息来源\n"
        "硬性要求：\n"
        "1. 只写两期之间实际发生的变化，无变化的小节写「未发现明显变化」；\n"
        "2. 评分变动逐项列出（如：功能完备性 7 → 8），无变化的维度不列；\n"
        "3. 每节 1-4 条短句，突出对决策有价值的信息，不要复述报告全文；\n"
        "4. 直接输出 Markdown 正文，不要用代码块包裹。"
    )
    user = (
        f"调研对象：{product_name}\n\n"
        f"【上一期报告（{prev_date}）】\n{prev_report}\n\n"
        f"【上一期评分】\n{prev_scores}\n\n"
        f"【本期报告】\n{cur_report}\n\n"
        f"【本期评分】\n{cur_scores}"
    )
    try:
        summary = await llm.chat(system, user)
    except Exception:
        logger.exception("change summary generation failed for task %s", task_id)
        return
    with SessionLocal() as db:
        task = db.get(ResearchTask, task_id)
        if task:
            task.change_summary = summary.strip()
            db.commit()

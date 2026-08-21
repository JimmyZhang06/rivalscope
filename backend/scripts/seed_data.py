"""Seed sample data for comp-agent demo."""
import json
import sqlite3
import uuid
import random
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.security import hash_password

DB_PATH = BACKEND_DIR / "research.db"
conn = sqlite3.connect(DB_PATH)
now = datetime.now(timezone.utc)
now_str = now.isoformat()


def uid():
    return uuid.uuid4().hex


def pw_hash():
    return hash_password("Test123456")


def invite_code():
    return "".join(
        random.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(8)
    )


def ago(days=0, hours=0):
    return (now - timedelta(days=days, hours=hours)).isoformat()


def later(days=0, hours=0):
    return (now + timedelta(days=days, hours=hours)).isoformat()


# ============================================================
# users
# ============================================================
users = {}
user_defs = [
    ("admin@example.com", "管理员", "admin", "enterprise", "", "", -1),
    ("zhangsan@test.com", "张三", "user", "pro", "", "", -1),
    ("lisi@test.com", "李四", "user", "free", "", "", -1),
    ("wangwu@test.com", "王五", "user", "free", "", "", -1),
    ("zhaoliu@test.com", "赵六", "user", "free", "", "", -1),
]
for email, nick, role, plan, org_id, org_role, limit_val in user_defs:
    uid_val = uid()
    users[email] = uid_val
    conn.execute(
        "INSERT INTO users "
        "(id,email,password_hash,nickname,avatar,role,plan,plan_expires_at,"
        "token_version,reset_code,reset_code_expires_at,org_id,org_role,org_monthly_limit,created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (uid_val, email, pw_hash(), nick, "", role, plan, None,
         0, "", None, org_id, org_role, limit_val, now_str),
    )

# ============================================================
# organizations
# ============================================================
org_defs = [
    ("测试科技", "pro", users["zhangsan@test.com"]),
    ("Demo公司", "free", users["lisi@test.com"]),
]
org_map = {}
for name, plan, owner_uid in org_defs:
    oid = uid()
    code = invite_code()
    org_map[name] = oid
    conn.execute(
        "INSERT INTO organizations (id,name,plan,owner_id,invite_code,created_at) "
        "VALUES (?,?,?,?,?,?)",
        (oid, name, plan, owner_uid, code, now_str),
    )

# assign org membership
conn.execute(
    "UPDATE users SET org_id=?, org_role=? WHERE email=?",
    (org_map["测试科技"], "owner", "zhangsan@test.com"),
)
conn.execute(
    "UPDATE users SET org_id=?, org_role=? WHERE email=?",
    (org_map["测试科技"], "member", "lisi@test.com"),
)
conn.execute(
    "UPDATE users SET org_id=?, org_role=? WHERE email=?",
    (org_map["Demo公司"], "owner", "lisi@test.com"),
)
conn.execute(
    "UPDATE users SET org_id=?, org_role=? WHERE email=?",
    (org_map["Demo公司"], "member", "wangwu@test.com"),
)

# ============================================================
# competitors
# ============================================================
tech_org = org_map["测试科技"]
comp_defs = [
    ("大疆创新", "https://www.dji.com/cn", "无人机,影像,云台", "DJI,无人机,航拍", tech_org),
    ("小米", "https://www.mi.com", "智能手机,AIoT,汽车", "小米,手机,生态链", tech_org),
    ("影石", "https://www.insta360.com/cn/", "全景相机,运动相机,AI", "Insta360,全景,运动", ""),
    ("华为", "https://www.huawei.com", "智能手机,5G,云计算", "华为,鸿蒙,5G", ""),
    ("OPPO", "https://www.oppo.com", "智能手机,快充,影像", "OPPO,Reno,Find", ""),
]
comp_map = {}
for cname, website, tech, keywords, oid in comp_defs:
    cid = uid()
    comp_map[cname] = cid
    conn.execute(
        "INSERT INTO competitors "
        "(id,org_id,name,alias,website,tech_focus,keywords,"
        "status,crawl_status,crawl_error,created_at,updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (cid, oid, cname, cname, website, tech, json.dumps([item.strip() for item in keywords.split(",")], ensure_ascii=False),
         "active", "done", "", now_str, now_str),
    )

# ============================================================
# profile templates (system-level: org_id='')
# ============================================================
template_defs = [
    {
        "name": "标准竞品画像",
        "dims": json.dumps([
            {"key": "product_overview", "label": "产品概况", "fields": [
                {"key": "name", "label": "产品名称", "type": "text"},
                {"key": "category", "label": "产品类别", "type": "text"},
                {"key": "price_range", "label": "价格区间", "type": "text"},
                {"key": "main_features", "label": "核心卖点", "type": "text"},
            ]},
            {"key": "company_info", "label": "企业信息", "fields": [
                {"key": "founded", "label": "成立时间", "type": "text"},
                {"key": "headquarters", "label": "总部", "type": "text"},
                {"key": "scale", "label": "公司规模", "type": "text"},
            ]},
            {"key": "market_position", "label": "市场定位", "fields": [
                {"key": "segments", "label": "目标用户", "type": "text"},
                {"key": "channels", "label": "渠道", "type": "text"},
                {"key": "advantages", "label": "竞争优势", "type": "text"},
            ]},
            {"key": "tech_analysis", "label": "技术分析", "fields": [
                {"key": "stack", "label": "技术栈", "type": "text"},
                {"key": "patents", "label": "专利/自研", "type": "text"},
                {"key": "r_and_d", "label": "研发投入", "type": "text"},
            ]},
            {"key": "risk_opportunity", "label": "风险与机会", "fields": [
                {"key": "threats", "label": "威胁", "type": "text"},
                {"key": "opportunities", "label": "机会", "type": "text"},
            ]},
        ], ensure_ascii=False),
    },
    {
        "name": "深度技术画像",
        "dims": json.dumps([
            {"key": "overview", "label": "概览", "fields": [
                {"key": "summary", "label": "一句话总结", "type": "text"},
                {"key": "url", "label": "官网", "type": "text"},
            ]},
            {"key": "tech_stack", "label": "技术栈", "fields": [
                {"key": "frontend", "label": "前端", "type": "text"},
                {"key": "backend", "label": "后端", "type": "text"},
                {"key": "infra", "label": "基础设施", "type": "text"},
            ]},
            {"key": "recent_changes", "label": "近期变更", "fields": [
                {"key": "changelog", "label": "变更内容", "type": "text"},
            ]},
            {"key": "open_source", "label": "开源项目", "fields": [
                {"key": "repos", "label": "仓库/工具", "type": "text"},
            ]},
        ], ensure_ascii=False),
    },
    {
        "name": "简洁画像",
        "dims": json.dumps([
            {"key": "basic", "label": "基本信息", "fields": [
                {"key": "name", "label": "名称", "type": "text"},
                {"key": "category", "label": "类别", "type": "text"},
                {"key": "price", "label": "价格", "type": "text"},
            ]},
            {"key": "highlights", "label": "亮点", "fields": [
                {"key": "highlight", "label": "主要亮点", "type": "text"},
            ]},
            {"key": "notes", "label": "备注", "fields": [
                {"key": "note", "label": "备注", "type": "text"},
            ]},
        ], ensure_ascii=False),
    },
]

for td in template_defs:
    tid = uid()
    conn.execute(
        "INSERT INTO profile_templates (id,org_id,name,dimensions,version,frozen_at,created_by,created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (tid, "", td["name"], td["dims"], 1, now_str, users["admin@example.com"], now_str),
    )

# ============================================================
# research tasks + steps
# ============================================================
task_defs = [
    ("小米", users["zhangsan@test.com"], tech_org, "completed", "调研小米最新产品线及市场策略"),
    ("大疆创新", users["zhangsan@test.com"], tech_org, "completed", "分析大疆无人机技术壁垒"),
    ("影石", users["zhangsan@test.com"], tech_org, "reporting", "全景相机市场竞品分析"),
    ("华为", users["zhangsan@test.com"], tech_org, "completed", "华为鸿蒙生态调研"),
    ("OPPO", users["zhangsan@test.com"], tech_org, "searching", "OPPO影像技术分析"),
]
for pname, uid_val, oid, status, focus in task_defs:
    tid = uid()
    created = ago(random.randint(1, 14))
    updated = ago(random.randint(0, 2))
    conn.execute(
        "INSERT INTO research_tasks "
        "(id,user_id,org_id,tracker_id,product_name,competitors,focus,time_range,"
        "status,error,report_markdown,report_data,change_summary,created_at,updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (tid, uid_val, oid, "", pname, "", focus, "year",
         status, "", "", "", "", created, updated),
    )
    for i, (phase, title) in enumerate([
        ("planning", "制定调研计划"),
        ("searching", "执行联网检索"),
        ("analyzing", "信息分析整理"),
        ("reporting", "生成调研报告"),
    ]):
        sid = uid()
        conn.execute(
            "INSERT INTO task_steps (id,task_id,seq,phase,title,detail,created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (sid, tid, i, phase, title, f"步骤 {i+1} 完成", created),
        )

# ============================================================
# notifications
# ============================================================
for uid_val, oid, title, body, link in [
    (users["zhangsan@test.com"], tech_org, "调研任务完成", "「小米」调研报告已生成", "/app/tasks"),
    (users["zhangsan@test.com"], tech_org, "新竞品已爬取", "「大疆创新」官网内容已更新", "/app/competitors"),
    (users["zhangsan@test.com"], "", "系统通知", "欢迎使用竞品调研 Agent", "/app/dashboard"),
]:
    nid = uid()
    conn.execute(
        "INSERT INTO notifications (id,user_id,org_id,title,body,link,read,created_at) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (nid, uid_val, oid, title, body, link, 0, now_str),
    )

# ============================================================
# trackers
# ============================================================
tid = uid()
conn.execute(
    "INSERT INTO trackers "
    "(id,org_id,creator_id,product_name,competitors,focus,time_range,"
    "frequency,run_hour,next_run_at,last_run_at,enabled,"
    "push_email,push_webhook,webhook_type,webhook_url,created_at) "
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    (tid, tech_org, users["zhangsan@test.com"],
     "小米", "", "跟踪小米产品变化",
     "year", "weekly", 9,
     later(days=7), now_str,
     1, 0, 0, "generic", "", now_str),
)

# ============================================================
# verify
# ============================================================
conn.commit()
for t in [
    "users", "organizations", "competitors",
    "profile_templates", "research_tasks", "task_steps",
    "notifications", "trackers",
]:
    n = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    print(f"{t}: {n}")
conn.close()
print("Sample data seeded successfully!")

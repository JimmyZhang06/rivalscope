"""迁移脚本：将 profile_data 中的 report_markdown / insights / source_index 拆分到独立列

用法：
    cd backend && python -m scripts.migrate_profile_columns
"""
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db.database import SessionLocal
from app.db.models import CompetitorProfile


def migrate() -> None:
    with SessionLocal() as db:
        profiles = db.query(CompetitorProfile).all()
        count = 0
        for p in profiles:
            raw = p.profile_data or "{}"
            data = json.loads(raw) if isinstance(raw, str) else dict(raw)

            changed = False
            for col, key in [
                ("report_markdown", "report_markdown"),
                ("insights_json", "insights"),
                ("source_index_json", "source_index"),
            ]:
                if key in data and not getattr(p, col):
                    val = data.pop(key)
                    if isinstance(val, (dict, list)):
                        val = json.dumps(val, ensure_ascii=False)
                    setattr(p, col, val or "")
                    changed = True

            if changed:
                p.profile_data = json.dumps(data, ensure_ascii=False)
                count += 1

        db.commit()
        print(f"迁移完成：{count}/{len(profiles)} 条画像已拆分")


if __name__ == "__main__":
    migrate()

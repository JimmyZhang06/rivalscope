import asyncio

from app.services import profile_extractor


def test_profile_pregeneration_uses_task_org_when_result_omits_org(monkeypatch):
    task = profile_extractor.ProfileGenerationTask(
        task_id="task-1",
        competitor_id="competitor-1",
        template_id="template-1",
        user_id="user-1",
        org_id="org-1",
    )
    profile_extractor._generation_tasks[task.task_id] = task

    async def fake_generate_profile(*_args, **_kwargs):
        return {"id": "profile-1", "status": "draft"}

    seen_orgs: list[str] = []

    async def fake_report(_profile_id: str, _user_id: str, org_id: str):
        seen_orgs.append(org_id)
        raise RuntimeError("stop after verifying org context")

    monkeypatch.setattr("app.services.profiles.generate_profile", fake_generate_profile)
    monkeypatch.setattr("app.services.profile_report.generate_profile_report", fake_report)
    monkeypatch.setattr(profile_extractor, "_persist_generation_task", lambda _task: None)

    asyncio.run(profile_extractor._run_profile_generation_task(task.task_id))

    assert seen_orgs == ["org-1"]
    assert task.status == "done"
    assert "stop after verifying org context" in task.error

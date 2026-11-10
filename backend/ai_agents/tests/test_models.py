"""Model-layer tests for the ai_agents app."""

from __future__ import annotations

import pytest

from ai_agents.models import (
    AGENT_DEAL_COACH,
    AGENT_LEAD_RESEARCH,
    AIAgentRun,
    STATUS_RUNNING,
)


pytestmark = pytest.mark.django_db


def test_agent_run_defaults_and_str(active_tenant):  # type: ignore[no-untyped-def]
    run = AIAgentRun.objects.create(
        tenant=active_tenant,
        agent_type=AGENT_LEAD_RESEARCH,
        target_module="lead",
        target_id="42",
    )
    assert run.status == STATUS_RUNNING
    assert run.result == {}
    assert run.completed_at is None
    assert "lead:42" in str(run)


def test_agent_run_supports_all_types(active_tenant):  # type: ignore[no-untyped-def]
    for at in (AGENT_LEAD_RESEARCH, AGENT_DEAL_COACH):
        AIAgentRun.objects.create(tenant=active_tenant, agent_type=at)
    assert AIAgentRun.objects.filter(tenant=active_tenant).count() == 2

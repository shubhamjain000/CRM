"""Service-layer tests for the ai_agents app."""

from __future__ import annotations

import pytest

from ai_agents.models import (
    AGENT_DATA_HYGIENE,
    AGENT_LEAD_RESEARCH,
    AIAgentRun,
    STATUS_COMPLETED,
)
from ai_agents.services import (
    run_agent,
    run_data_hygiene,
    run_lead_research,
)


pytestmark = pytest.mark.django_db


def test_run_lead_research_completes_and_writes_result(active_tenant):  # type: ignore[no-untyped-def]
    run = run_lead_research("42", tenant=active_tenant)
    assert run.status == STATUS_COMPLETED
    assert run.completed_at is not None
    assert "talking_points" in run.result
    assert run.tenant_id == active_tenant.pk


def test_run_agent_unknown_type_raises(active_tenant):  # type: ignore[no-untyped-def]
    with pytest.raises(ValueError):  # noqa: PT011
        run_agent("does-not-exist", tenant=active_tenant)


def test_run_data_hygiene_uses_module_arg(active_tenant):  # type: ignore[no-untyped-def]
    run = run_data_hygiene("lead", tenant=active_tenant)
    assert run.agent_type == AGENT_DATA_HYGIENE
    assert run.result["module"] == "lead"
    # Confirm a row was persisted.
    assert AIAgentRun.objects.filter(tenant=active_tenant, agent_type=AGENT_DATA_HYGIENE).count() == 1

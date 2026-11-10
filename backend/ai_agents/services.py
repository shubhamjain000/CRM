"""Service layer for the ai_agents app.

Five ``run_*`` functions, one per agent type. Each:

1. Creates an :class:`AIAgentRun` row with ``status=running``.
2. Runs the agent logic (stubbed — deterministic JSON output; production
   would call :func:`ai_core.services.call_llm` with agent-specific
   system prompts).
3. Marks the row ``status=completed`` (or ``status=failed`` on
   exception) and writes the ``result`` JSON.

A generic :func:`run_agent` dispatcher is used by the ``trigger``
viewset action and the Celery tasks.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Callable

from django.utils import timezone

from .models import (
    AGENT_CUSTOMER_SUCCESS,
    AGENT_DATA_HYGIENE,
    AGENT_DEAL_COACH,
    AGENT_EMAIL_TRIAGE,
    AGENT_LEAD_RESEARCH,
    AIAgentRun,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_RUNNING,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization

log = logging.getLogger(__name__)


###############################################################################
# Agent implementations (stubs — deterministic JSON output)
###############################################################################


def _lead_research(target_id: str, tenant: "Organization | None") -> dict[str, Any]:
    return {
        "company_info": {"name": f"Company for lead {target_id}", "industry": "Unknown"},
        "talking_points": [
            "Recent funding round",
            "New product launch",
            "Industry award",
        ],
        "drafted_email": f"Hi — reaching out about lead {target_id}.",
    }


def _deal_coach(target_id: str, tenant: "Organization | None") -> dict[str, Any]:
    return {
        "stage_assessment": "Deal is in negotiation; risk of slipping.",
        "next_steps": [
            "Send revised quote",
            "Loop in decision maker",
            "Schedule follow-up call",
        ],
        "win_probability": 0.55,
    }


def _email_triage(target_id: str, tenant: "Organization | None") -> dict[str, Any]:
    return {
        "category": "follow_up",
        "priority": "high",
        "suggested_response": f"Thanks for your email ({target_id}); happy to help.",
        "summary": "Customer is requesting a follow-up call.",
    }


def _data_hygiene(target_module: str, tenant: "Organization | None") -> dict[str, Any]:
    return {
        "module": target_module or "lead",
        "issues_found": [
            "3 records missing email",
            "5 records with stale phone",
        ],
        "fixes_applied": 0,
    }


def _customer_success(
    target_id: str, tenant: "Organization | None"
) -> dict[str, Any]:
    return {
        "account_id": target_id,
        "health_score": 72,
        "risks": ["No exec check-in 60d", "Low product usage"],
        "next_actions": ["Schedule QBR", "Send usage tips email"],
    }


_AGENT_IMPLEMENTATIONS: dict[str, Callable[..., dict[str, Any]]] = {
    AGENT_LEAD_RESEARCH: _lead_research,
    AGENT_DEAL_COACH: _deal_coach,
    AGENT_EMAIL_TRIAGE: _email_triage,
    AGENT_DATA_HYGIENE: _data_hygiene,
    AGENT_CUSTOMER_SUCCESS: _customer_success,
}


###############################################################################
# run_agent dispatcher
###############################################################################


def run_agent(
    agent_type: str,
    target_module: str = "",
    target_id: str = "",
    *,
    tenant: "Organization | None" = None,
) -> AIAgentRun:
    """Create an AIAgentRun row + execute the agent + finalize the row.

    Used by both the ``trigger`` viewset action and the per-type Celery
    tasks.
    """
    from api.managers import get_current_tenant  # noqa: PLC0415

    if tenant is None:
        tenant = get_current_tenant()
    if tenant is None:
        raise RuntimeError("run_agent requires a tenant context.")
    impl = _AGENT_IMPLEMENTATIONS.get(agent_type)
    if impl is None:
        raise ValueError(f"Unknown agent_type: {agent_type!r}")

    run = AIAgentRun.objects.create(
        tenant=tenant,
        agent_type=agent_type,
        target_module=target_module,
        target_id=str(target_id),
        status=STATUS_RUNNING,
    )
    try:
        # data_hygiene receives the module name as its target_id argument
        # by convention.
        arg = target_module if agent_type == AGENT_DATA_HYGIENE else str(target_id)
        result = impl(arg, tenant)
        run.result = result
        run.status = STATUS_COMPLETED
    except Exception as exc:  # pragma: no cover — defensive
        log.exception("run_agent: %s failed", agent_type)
        run.result = {"error": str(exc)}
        run.status = STATUS_FAILED
    run.completed_at = timezone.now()
    run.save(update_fields=["result", "status", "completed_at", "updated_at"])
    return run


###############################################################################
# Per-type wrappers (Celery tasks call these directly)
###############################################################################


def run_lead_research(lead_id: str, *, tenant: "Organization | None" = None) -> AIAgentRun:
    return run_agent(
        AGENT_LEAD_RESEARCH, target_module="lead", target_id=str(lead_id), tenant=tenant
    )


def run_deal_coach(deal_id: str, *, tenant: "Organization | None" = None) -> AIAgentRun:
    return run_agent(
        AGENT_DEAL_COACH, target_module="deal", target_id=str(deal_id), tenant=tenant
    )


def run_email_triage(email_id: str, *, tenant: "Organization | None" = None) -> AIAgentRun:
    return run_agent(
        AGENT_EMAIL_TRIAGE,
        target_module="email",
        target_id=str(email_id),
        tenant=tenant,
    )


def run_data_hygiene(
    module: str, *, tenant: "Organization | None" = None
) -> AIAgentRun:
    return run_agent(
        AGENT_DATA_HYGIENE, target_module=module or "lead", target_id="", tenant=tenant
    )


def run_customer_success(
    account_id: str, *, tenant: "Organization | None" = None
) -> AIAgentRun:
    return run_agent(
        AGENT_CUSTOMER_SUCCESS,
        target_module="account",
        target_id=str(account_id),
        tenant=tenant,
    )


__all__ = [
    "run_agent",
    "run_customer_success",
    "run_data_hygiene",
    "run_deal_coach",
    "run_email_triage",
    "run_lead_research",
]

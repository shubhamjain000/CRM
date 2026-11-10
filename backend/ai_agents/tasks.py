"""Celery tasks for the ai_agents app.

Five per-type tasks (one per agent) + a 5-minute sweep task. The
per-type tasks are dispatched by CRM signals (new lead → lead_research;
deal update → deal_coach; email received → email_triage). The
``ai-agents-run`` Celery beat entry (every 5 minutes) re-runs pending
data-hygiene + customer-success sweeps across every tenant.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task

log = logging.getLogger(__name__)


@shared_task(name="ai_agents.run_lead_research")
def run_lead_research_task(lead_id: str) -> dict[str, Any]:
    from .services import run_lead_research  # noqa: PLC0415

    run = run_lead_research(lead_id)
    return {"run_id": run.pk, "status": run.status}


@shared_task(name="ai_agents.run_deal_coach")
def run_deal_coach_task(deal_id: str) -> dict[str, Any]:
    from .services import run_deal_coach  # noqa: PLC0415

    run = run_deal_coach(deal_id)
    return {"run_id": run.pk, "status": run.status}


@shared_task(name="ai_agents.run_email_triage")
def run_email_triage_task(email_id: str) -> dict[str, Any]:
    from .services import run_email_triage  # noqa: PLC0415

    run = run_email_triage(email_id)
    return {"run_id": run.pk, "status": run.status}


@shared_task(name="ai_agents.run_data_hygiene")
def run_data_hygiene_task(module: str = "lead") -> dict[str, Any]:
    from .services import run_data_hygiene  # noqa: PLC0415

    run = run_data_hygiene(module)
    return {"run_id": run.pk, "status": run.status}


@shared_task(name="ai_agents.run_customer_success")
def run_customer_success_task(account_id: str) -> dict[str, Any]:
    from .services import run_customer_success  # noqa: PLC0415

    run = run_customer_success(account_id)
    return {"run_id": run.pk, "status": run.status}


@shared_task(name="ai_agents.run_pending_sweep")
def run_pending_sweep_task() -> dict[str, int]:
    """Every 5 minutes — re-run data-hygiene + customer-success sweeps.

    Triggered by the ``ai-agents-run`` Celery beat entry. Dispatches one
    data-hygiene task per tenant.
    """
    from api.models import Organization  # noqa: PLC0415

    dispatched = 0
    for _tenant in Organization.objects.all():
        run_data_hygiene_task.delay("lead")
        dispatched += 1
    return {"dispatched": dispatched}


__all__ = [
    "run_customer_success_task",
    "run_data_hygiene_task",
    "run_deal_coach_task",
    "run_email_triage_task",
    "run_lead_research_task",
    "run_pending_sweep_task",
]

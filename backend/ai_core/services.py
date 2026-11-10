"""Service layer for the ai_core app.

Public surface:

* :func:`call_llm` — uniform choke-point for every LLM invocation in the
  backend. Stub implementation: returns a deterministic echo response,
  computes cost from :data:`MODEL_PRICING_USD_PER_1K`, logs a row to
  :class:`AICostLog`. In production the body of this function is
  replaced with the real OpenAI / Anthropic / Gemini SDK call (selected
  by ``model``).
* :func:`stream_llm` — generator stub that yields the same response in
  chunks (so downstream SSE / WebSocket consumers can be wired today).
* :func:`check_budget` — return ``{spent, budget, remaining,
  period_start, period_end}`` for the tenant's current calendar month.
* :func:`get_active_template` / :func:`activate_template` — fetch the
  active :class:`PromptTemplate` for a name, or atomically flip the
  active flag.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Iterator

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from .models import (
    AICostLog,
    DEFAULT_MONTHLY_BUDGET_USD,
    MODEL_PRICING_USD_PER_1K,
    PromptTemplate,
    TASK_CHAT,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization

log = logging.getLogger(__name__)

# Rough token-per-char heuristic so the stub can estimate token counts
# without a real tokenizer. Real impl would use tiktoken / Anthropic's
# count_tokens endpoint.
_CHARS_PER_TOKEN = 4


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // _CHARS_PER_TOKEN)


def _compute_cost(model: str, input_tokens: int, output_tokens: int) -> Decimal:
    in_price, out_price = MODEL_PRICING_USD_PER_1K.get(
        model, MODEL_PRICING_USD_PER_1K["gpt-4o-mini"]
    )
    return (
        Decimal(input_tokens) * in_price / Decimal(1000)
        + Decimal(output_tokens) * out_price / Decimal(1000)
    ).quantize(Decimal("0.000001"))


def _month_bounds(ref: date) -> tuple[date, date]:
    start = ref.replace(day=1)
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return start, end


###############################################################################
# call_llm
###############################################################################


def call_llm(
    messages: list[dict[str, str]],
    model: str = "gpt-4o-mini",
    temperature: float = 0.7,
    max_tokens: int = 1000,
    *,
    task_type: str = TASK_CHAT,
    tenant: "Organization | None" = None,
) -> dict[str, Any]:
    """Call the LLM ``model`` with ``messages`` and return a response dict.

    The stub body returns a deterministic echo response — the real SDK
    call would replace the body. Either way the cost + token counts are
    written to :class:`AICostLog` (against ``tenant`` resolved from the
    thread-local when ``None``).

    Returns ``{content, model, input_tokens, output_tokens, cost,
    task_type}``.
    """
    from api.managers import get_current_tenant  # noqa: PLC0415

    if tenant is None:
        tenant = get_current_tenant()

    input_text = " ".join(m.get("content", "") for m in messages)
    input_tokens = _estimate_tokens(input_text)
    # Deterministic stub output — round-trips the last user message.
    last_user = next(
        (m["content"] for m in reversed(messages) if m.get("role") == "user"),
        "",
    )
    stub_content = f"[{model} t={temperature} max={max_tokens}] {last_user[:200]}"
    output_tokens = _estimate_tokens(stub_content)
    cost = _compute_cost(model, input_tokens, output_tokens)

    if tenant is not None:
        AICostLog.objects.create(
            tenant=tenant,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost=cost,
            task_type=task_type,
        )
    log.debug(
        "call_llm: model=%s in=%d out=%d cost=$%s task=%s",
        model, input_tokens, output_tokens, cost, task_type,
    )
    return {
        "content": stub_content,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost": str(cost),
        "task_type": task_type,
    }


###############################################################################
# stream_llm
###############################################################################


def stream_llm(
    messages: list[dict[str, str]],
    model: str = "gpt-4o-mini",
    temperature: float = 0.7,
    max_tokens: int = 1000,
    *,
    task_type: str = TASK_CHAT,
    tenant: "Organization | None" = None,
    chunk_size: int = 16,
) -> Iterator[str]:
    """Yield ``chunk_size``-char chunks of the stub response.

    The real implementation would yield ``iter_lines()`` from the
    provider's streaming endpoint; the call_llm cost-log write happens
    after the stream closes. For the stub we just chunk the deterministic
    echo from :func:`call_llm`.
    """
    response = call_llm(
        messages,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        task_type=task_type,
        tenant=tenant,
    )
    content = response["content"]
    for i in range(0, len(content), chunk_size):
        yield content[i : i + chunk_size]


###############################################################################
# check_budget
###############################################################################


def check_budget(
    tenant: "Organization | None" = None, *, ref: date | None = None
) -> dict[str, Any]:
    """Return ``{spent, budget, remaining, period_start, period_end}`` for the
    tenant's current calendar month.

    ``budget`` is the per-plan cap (stub: :data:`DEFAULT_MONTHLY_BUDGET_USD`).
    ``remaining`` is ``budget - spent`` (never below 0).
    """
    from api.managers import get_current_tenant  # noqa: PLC0415

    if tenant is None:
        tenant = get_current_tenant()
    today = ref or timezone.now().date()
    period_start, period_end = _month_bounds(today)

    if tenant is None:
        return {
            "spent": "0",
            "budget": str(DEFAULT_MONTHLY_BUDGET_USD),
            "remaining": str(DEFAULT_MONTHLY_BUDGET_USD),
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
        }

    agg = AICostLog.objects.filter(
        tenant=tenant,
        created_at__date__gte=period_start,
        created_at__date__lte=period_end,
    ).aggregate(total=Sum("cost"))
    spent = agg["total"] or Decimal(0)
    budget = DEFAULT_MONTHLY_BUDGET_USD
    remaining = max(Decimal(0), budget - spent)
    return {
        "spent": str(spent),
        "budget": str(budget),
        "remaining": str(remaining),
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
    }


###############################################################################
# PromptTemplate helpers
###############################################################################


def get_active_template(
    name: str, *, tenant: "Organization | None" = None
) -> PromptTemplate | None:
    """Return the active :class:`PromptTemplate` for ``name`` or ``None``."""
    qs = PromptTemplate.objects.filter(name=name, is_active=True)
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    return qs.order_by("-version").first()


@transaction.atomic
def activate_template(template: PromptTemplate) -> None:
    """Mark ``template`` active and every same-name sibling inactive (atomic)."""
    PromptTemplate.objects.filter(
        tenant=template.tenant,
        name=template.name,
    ).exclude(pk=template.pk).update(is_active=False)
    if not template.is_active:
        template.is_active = True
        template.save(update_fields=["is_active", "updated_at"])


__all__ = [
    "activate_template",
    "call_llm",
    "check_budget",
    "get_active_template",
    "stream_llm",
]

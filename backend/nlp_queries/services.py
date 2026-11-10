"""Service layer for the nlp_queries app.

* :func:`parse_query` — keyword-matching NL→spec parser. Recognises:
  - "deals closing this month" → ``{model: "deal", filters:
    {"close_date": "this_month"}}``
  - "open leads" → ``{model: "lead", filters: {"status": "open"}}``
  - "won deals" → ``{model: "deal", filters: {"stage.is_won_stage":
    True}}``
  Falls back to ``{model: "unknown", filters: {}}`` for unmatched
  questions.
* :func:`execute_query` — runs the spec against the appropriate CRM ORM
  model (lazy import) and returns
  ``{count, sample: [first 10 ids], summary}``.
* :func:`save_as_report` — promote a saved NLPQuery into a row in the
  :mod:`reports` app (lazy import; best-effort).
"""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any

from django.utils import timezone

from .models import NLPQuery

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization

log = logging.getLogger(__name__)


###############################################################################
# parse_query
###############################################################################

_MONTH_RE = re.compile(r"\bthis month\b", re.IGNORECASE)
_WEEK_RE = re.compile(r"\bthis week\b", re.IGNORECASE)
_DEALS_RE = re.compile(r"\bdeals?\b", re.IGNORECASE)
_LEADS_RE = re.compile(r"\bleads?\b", re.IGNORECASE)
_ACCOUNTS_RE = re.compile(r"\baccounts?\b", re.IGNORECASE)
_CONTACTS_RE = re.compile(r"\bcontacts?\b", re.IGNORECASE)
_OPEN_RE = re.compile(r"\bopen\b", re.IGNORECASE)
_WON_RE = re.compile(r"\bwon\b", re.IGNORECASE)
_LOST_RE = re.compile(r"\blost\b", re.IGNORECASE)
_CLOSING_RE = re.compile(r"\bclosing\b", re.IGNORECASE)


def parse_query(question: str) -> dict[str, Any]:
    """Return ``{model, filters, period}`` parsed from ``question``."""
    model = "unknown"
    if _DEALS_RE.search(question):
        model = "deal"
    elif _LEADS_RE.search(question):
        model = "lead"
    elif _ACCOUNTS_RE.search(question):
        model = "account"
    elif _CONTACTS_RE.search(question):
        model = "contact"

    filters: dict[str, Any] = {}
    period = None
    if _MONTH_RE.search(question):
        period = "this_month"
    elif _WEEK_RE.search(question):
        period = "this_week"

    if model == "deal":
        if _WON_RE.search(question):
            filters["stage.is_won_stage"] = True
        elif _LOST_RE.search(question):
            filters["stage.is_lost_stage"] = True
        if _CLOSING_RE.search(question) or period:
            filters["close_date"] = period or "any"
    elif model == "lead":
        if _OPEN_RE.search(question):
            filters["status"] = "open"
    return {"model": model, "filters": filters, "period": period}


###############################################################################
# execute_query
###############################################################################

def _this_month_bounds() -> tuple[date, date]:
    today = timezone.now().date()
    start = today.replace(day=1)
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return start, end


def _apply_filters(qs: Any, spec: dict[str, Any]) -> Any:
    filters = spec.get("filters") or {}
    for key, value in filters.items():
        if key == "close_date":
            if value == "this_month":
                start, end = _this_month_bounds()
                qs = qs.filter(close_date__gte=start, close_date__lte=end)
            # 'any' / None → no filter
        elif key == "stage.is_won_stage":
            try:
                from deals.models_pipeline import Stage  # noqa: PLC0415

                won = Stage.objects.filter(is_won_stage=True)
                qs = qs.filter(stage__in=won)
            except Exception:  # pragma: no cover
                pass
        elif key == "stage.is_lost_stage":
            try:
                from deals.models_pipeline import Stage  # noqa: PLC0415

                lost = Stage.objects.filter(is_lost_stage=True)
                qs = qs.filter(stage__in=lost)
            except Exception:  # pragma: no cover
                pass
        elif key == "status" and value == "open":
            qs = qs.filter(status="open") | qs.filter(status="new")
        elif "__" not in key and isinstance(value, str | bool | int):
            qs = qs.filter(**{key: value})
    return qs


def execute_query(spec: dict[str, Any], *, tenant: "Organization | None" = None) -> dict[str, Any]:
    """Run ``spec`` against the appropriate CRM ORM model.

    Returns ``{count, sample, summary}``.
    """
    from api.managers import get_current_tenant  # noqa: PLC0415

    if tenant is None:
        tenant = get_current_tenant()
    model = spec.get("model", "unknown")
    qs: Any = None
    try:
        if model == "deal":
            from deals.models import Deal  # noqa: PLC0415

            qs = Deal.objects.all()
        elif model == "lead":
            from leads.models import Lead  # noqa: PLC0415

            qs = Lead.objects.all()
        elif model == "account":
            from accounts.models import Account  # noqa: PLC0415

            qs = Account.objects.all()
        elif model == "contact":
            from contacts.models import Contact  # noqa: PLC0415

            qs = Contact.objects.all()
    except Exception:  # pragma: no cover — model unavailable
        log.debug("execute_query: model %s unavailable", model)
        qs = None

    if qs is None:
        return {"count": 0, "sample": [], "summary": f"Unknown model: {model}"}

    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    qs = _apply_filters(qs, spec)
    count = qs.count()
    sample = list(qs.values_list("pk", flat=True)[:10])
    summary = f"{count} {model}(s) match the query."
    return {"count": count, "sample": [str(pk) for pk in sample], "summary": summary}


###############################################################################
# save_as_report
###############################################################################

def save_as_report(query_id: int | str, *, tenant: "Organization | None" = None) -> dict[str, Any]:
    """Promote an :class:`NLPQuery` row into a :mod:`reports` Report row.

    Best-effort — returns ``{report_id}`` on success or ``{error: "..."}``
    when the reports app is unavailable.
    """
    nlp = NLPQuery.objects.get(pk=query_id)
    try:  # pragma: no cover — reports may be uninstalled
        from reports.models import Report  # noqa: PLC0415
    except Exception:
        return {"error": "reports app unavailable"}
    report = Report.objects.create(
        tenant=nlp.tenant,
        name=f"NLP: {nlp.question[:80]}",
        source_model=nlp.generated_spec.get("model", "deal"),
        config={
            "filters": nlp.generated_spec.get("filters", {}),
            "period": nlp.generated_spec.get("period"),
        },
    )
    return {"report_id": report.pk}


__all__ = ["execute_query", "parse_query", "save_as_report"]

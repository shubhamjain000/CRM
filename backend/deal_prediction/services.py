"""Service layer for the deal_prediction app.

Heuristic prediction:

* ``close_probability`` = the deal's stage probability (0..1).
* ``expected_value`` = ``deal.amount * close_probability``.
* ``expected_close_date`` = the deal's ``close_date`` (may be ``None``).

``predict_deal`` reads the prior row's ``close_probability`` (stashed
into ``factors.previous_probability``) so the next call can detect a
week-over-week drop. ``get_at_risk`` returns rows whose
``close_probability`` fell by more than 20% relative to that prior.

Lazy imports of the ``deals`` app keep module load cheap.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import transaction
from django.utils import timezone

from .models import AT_RISK_DROP_THRESHOLD, MODEL_VERSION, PredictedDealValue

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization

log = logging.getLogger(__name__)


def _deal_to_prediction(
    deal: Any, previous_probability: float | None
) -> dict[str, Any]:
    """Pull the prediction-relevant fields off a Deal (duck-typed)."""
    amount = getattr(deal, "amount", None) or Decimal(0)
    stage = getattr(deal, "stage", None)
    stage_probability = float(getattr(stage, "probability", 0.5) or 0.5)
    expected_value = (Decimal(amount) * Decimal(str(stage_probability))).quantize(
        Decimal("0.01")
    )
    return {
        "expected_value": expected_value,
        "close_probability": stage_probability,
        "expected_close_date": getattr(deal, "close_date", None),
        "factors": {
            "amount": str(amount),
            "stage_probability": stage_probability,
            "stage_name": getattr(stage, "name", "") if stage is not None else "",
            "previous_probability": previous_probability,
        },
    }


@transaction.atomic
def predict_deal(deal_id: str, *, tenant: "Organization | None" = None) -> PredictedDealValue:
    """Compute + persist the prediction for ``deal_id``."""
    from api.managers import get_current_tenant  # noqa: PLC0415

    if tenant is None:
        tenant = get_current_tenant()

    prior = (
        PredictedDealValue.objects.filter(tenant=tenant, deal_id=str(deal_id)).first()
        if tenant is not None
        else None
    )
    previous_probability = prior.close_probability if prior is not None else None

    try:
        from deals.models import Deal  # noqa: PLC0415

        deal = Deal.objects.select_related("stage").filter(pk=deal_id).first()
    except Exception:  # pragma: no cover — deals app may be uninstalled
        log.exception("predict_deal: could not introspect Deal %s", deal_id)
        deal = None

    if deal is None:
        prediction = _deal_to_prediction(
            type("StubDeal", (), {"amount": Decimal(0), "stage": None, "close_date": None})(),
            previous_probability,
        )
    else:
        prediction = _deal_to_prediction(deal, previous_probability)
        if tenant is None:
            tenant = deal.tenant

    if tenant is None:
        raise RuntimeError("predict_deal requires a tenant context.")

    obj, _ = PredictedDealValue.objects.update_or_create(
        tenant=tenant,
        deal_id=str(deal_id),
        defaults={
            "expected_value": prediction["expected_value"],
            "close_probability": prediction["close_probability"],
            "expected_close_date": prediction["expected_close_date"],
            "factors": prediction["factors"],
            "model_version": MODEL_VERSION,
            "calculated_at": timezone.now(),
        },
    )
    return obj


def predict_all_deals(tenant: "Organization | None" = None) -> dict[str, int]:
    """Re-predict every Deal in ``tenant`` (or every tenant when ``None``).

    Called nightly by the ``deal-predict-all`` Celery beat entry.
    """
    try:
        from deals.models import Deal  # noqa: PLC0415
    except Exception:  # pragma: no cover
        log.exception("predict_all_deals: deals app unavailable")
        return {"predicted": 0, "errors": 0}

    qs = Deal.objects.all()
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    predicted = 0
    errors = 0
    for deal in qs.iterator():
        try:
            predict_deal(str(deal.pk), tenant=deal.tenant)
            predicted += 1
        except Exception:  # pragma: no cover — defensive
            log.exception("predict_deal failed for %s", deal.pk)
            errors += 1
    return {"predicted": predicted, "errors": errors}


def get_at_risk(
    tenant: "Organization | None" = None, *, limit: int = 50
) -> list[PredictedDealValue]:
    """Return rows whose ``close_probability`` dropped > 20% week-over-week.

    Computed as ``previous_probability - close_probability >
    previous_probability * AT_RISK_DROP_THRESHOLD``. Rows without a
    ``previous_probability`` are excluded.
    """
    qs = PredictedDealValue.objects.all()
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    out: list[PredictedDealValue] = []
    for row in qs.iterator():
        prev = (row.factors or {}).get("previous_probability")
        if prev is None or prev <= 0:
            continue
        drop = prev - row.close_probability
        if drop > prev * AT_RISK_DROP_THRESHOLD:
            out.append(row)
            if len(out) >= limit:
                break
    return out


__all__ = ["get_at_risk", "predict_all_deals", "predict_deal"]

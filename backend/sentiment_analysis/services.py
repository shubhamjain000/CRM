"""Service layer for the sentiment_analysis app.

* :func:`analyze_text` — counts positive vs negative word matches
  against small fixed lexicons; returns
  ``{sentiment: float in [-1,+1], confidence: float in [0,1]}``.
  ``sentiment = (pos_count - neg_count) / max(1, pos+neg)``;
  ``confidence = min(1, (pos+neg) / 10)``.
* :func:`analyze_record` — runs :func:`analyze_text` against the
  target record's text body (email body / note content / etc.) and
  persists a :class:`Sentiment` row.
* :func:`get_trend` — returns the last ``limit`` Sentiment rows for a
  (module, record_id) pair, oldest-first.
* :func:`get_heatmap` — returns ``{module: avg_sentiment}`` aggregates.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING, Any

from django.db.models import Avg
from django.utils import timezone

from .models import MODEL_VERSION, Sentiment

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization

log = logging.getLogger(__name__)

# Small fixed lexicons — production would use VADER / TextBlob / an
# LLM classification call.
_POSITIVE_WORDS = {
    "great", "excellent", "happy", "love", "good", "thanks", "thank",
    "amazing", "fantastic", "wonderful", "best", "pleased", "excited",
    "thrilled", "perfect", "awesome", "smooth", "fast", "helpful",
}
_NEGATIVE_WORDS = {
    "bad", "terrible", "awful", "hate", "angry", "frustrated", "slow",
    "broken", "bug", "issue", "problem", "worst", "disappointed",
    "unhappy", "confused", "delay", "fail", "failed", "cancel",
    "refund", "complaint",
}

_WORD_RE = re.compile(r"[a-zA-Z']+")


def analyze_text(text: str) -> dict[str, float]:
    """Return ``{sentiment, confidence}`` for ``text``.

    ``sentiment`` ∈ [-1, +1]; ``confidence`` ∈ [0, 1].
    """
    words = [w.lower() for w in _WORD_RE.findall(text or "")]
    pos = sum(1 for w in words if w in _POSITIVE_WORDS)
    neg = sum(1 for w in words if w in _NEGATIVE_WORDS)
    total = pos + neg
    if total == 0:
        return {"sentiment": 0.0, "confidence": 0.0}
    sentiment = (pos - neg) / total
    confidence = min(1.0, total / 10.0)
    return {"sentiment": round(sentiment, 3), "confidence": round(confidence, 3)}


def _resolve_record_text(module: str, record_id: str) -> str:
    """Pull a text body off a CRM record (best-effort, duck-typed)."""
    try:
        if module == "email":
            from email_integration.models import Email  # noqa: PLC0415

            obj = Email.objects.filter(pk=record_id).first()
            return getattr(obj, "body_text", "") or getattr(obj, "body", "") or ""
        if module == "note":
            from notes.models import Note  # noqa: PLC0415

            obj = Note.objects.filter(pk=record_id).first()
            return getattr(obj, "content", "") or ""
        if module == "lead":
            from leads.models import Lead  # noqa: PLC0415

            obj = Lead.objects.filter(pk=record_id).first()
            return getattr(obj, "description", "") or ""
    except Exception:  # pragma: no cover
        log.debug("sentiment: could not resolve %s:%s", module, record_id)
    return ""


def analyze_record(
    module: str,
    record_id: str,
    text: str | None = None,
    *,
    tenant: "Organization | None" = None,
) -> Sentiment:
    """Analyze + persist a :class:`Sentiment` row for ``(module, record_id)``."""
    from api.managers import get_current_tenant  # noqa: PLC0415

    if tenant is None:
        tenant = get_current_tenant()
    if text is None:
        text = _resolve_record_text(module, record_id)
    result = analyze_text(text)
    if tenant is None:
        raise RuntimeError("analyze_record requires a tenant context.")
    return Sentiment.objects.create(
        tenant=tenant,
        record_module=module,
        record_id=str(record_id),
        sentiment=result["sentiment"],
        confidence=result["confidence"],
        model_version=MODEL_VERSION,
        analyzed_at=timezone.now(),
    )


def get_trend(
    module: str, record_id: str, *, tenant: "Organization | None" = None, limit: int = 30
) -> list[Sentiment]:
    """Return the last ``limit`` Sentiment rows for ``(module, record_id)``."""
    qs = Sentiment.objects.filter(record_module=module, record_id=str(record_id))
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    return list(qs.order_by("-analyzed_at")[:limit][::-1])


def get_heatmap(
    tenant: "Organization | None" = None, *, days: int = 30
) -> dict[str, float]:
    """Return ``{record_module: avg_sentiment}`` for the last ``days`` days."""
    from datetime import timedelta  # noqa: PLC0415

    since = timezone.now() - timedelta(days=days)
    qs = Sentiment.objects.filter(analyzed_at__gte=since)
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    qs = qs.values("record_module").annotate(avg=Avg("sentiment"))
    return {row["record_module"]: round(row["avg"] or 0.0, 3) for row in qs}


__all__ = ["analyze_record", "analyze_text", "get_heatmap", "get_trend"]

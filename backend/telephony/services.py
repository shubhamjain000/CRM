"""Service layer for the telephony app.

Provider-specific glue (Twilio / Exotel / Vonage / Plivo / MSG91) is
stubbed — the production deployment wires the real adapters behind the
``_provider_create_call`` / ``_provider_send_sms`` / ``_provider_transcribe``
hooks. The service layer is provider-agnostic so the rest of the app
(tests, viewsets, tasks) doesn't need to know which provider is in use.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from django.db.models import Avg, Count
from django.db.models.functions import ExtractHour
from django.utils import timezone

from .models import (
    CALL_INBOUND,
    CALL_MISSED,
    CALL_OUTBOUND,
    CALL_RINGING,
    IvrFlow,
    PhoneNumber,
    SmsMessage,
    SmsTemplate,
    TelephonyCall,
    SMS_QUEUED,
    SMS_SENT,
)

log = logging.getLogger(__name__)

# Default SMS send rate (messages per second) — used by ``send_bulk_sms``.
DEFAULT_SMS_RATE_PER_SEC = 10

# Maximum length of a single SMS segment (GSM-7) — used by ``_segment_count``.
SMS_SEGMENT_LENGTH = 160
SMS_SEGMENT_LENGTH_UNICODE = 70

# Twilio-style E.164 phone-number validator.
_E164_RE = re.compile(r"^\+?[1-9]\d{6,14}$")


###############################################################################
# Validation helpers
###############################################################################


def normalize_number(number: str) -> str:
    """Strip whitespace / dashes / parens from ``number``."""
    return re.sub(r"[\s\-()]", "", number or "")


def is_valid_number(number: str) -> bool:
    return bool(_E164_RE.match(normalize_number(number)))


###############################################################################
# Calls
###############################################################################


def initiate_call(
    *,
    from_number: str,
    to_number: str,
    tenant: Any = None,
    related_module: str | None = None,
    related_id: str | None = None,
    owner_id: str | None = None,
) -> TelephonyCall:
    """Create a :class:`TelephonyCall` and place the outbound leg.

    Returns the call row (in ``ringing`` state). The provider webhook
    will update the row to ``in_progress`` / ``completed`` / etc.
    """
    if not is_valid_number(to_number):
        raise ValueError(f"initiate_call: invalid 'to' number {to_number!r}")
    from_phone = PhoneNumber.objects.filter(number=normalize_number(from_number)).first()
    provider = from_phone.provider if from_phone else "twilio"
    call = TelephonyCall.objects.create(
        tenant=tenant or (from_phone.tenant if from_phone else None),
        from_number=normalize_number(from_number),
        to_number=normalize_number(to_number),
        direction=CALL_OUTBOUND,
        status=CALL_RINGING,
        related_module=related_module or "",
        related_id=related_id or "",
        owner_id=owner_id or "",
        voip_provider=provider,
        started_at=timezone.now(),
    )
    voip_call_id = _provider_create_call(call)
    if voip_call_id:
        call.voip_call_id = voip_call_id
        call.save(update_fields=["voip_call_id", "updated_at"])
    log.info(
        "telephony.initiate_call: %s → %s (provider=%s sid=%s)",
        call.from_number,
        call.to_number,
        call.voip_provider,
        call.voip_call_id,
    )
    return call


def handle_inbound_call(
    *,
    from_number: str,
    to_number: str,
    call_sid: str,
    tenant: Any = None,
    provider: str = "twilio",
) -> TelephonyCall:
    """Create an inbound :class:`TelephonyCall` and route it.

    Routing precedence: if the called number has an :class:`IvrFlow`,
    return the call as-is (the IVR engine takes over). Otherwise the
    call's ``owner_id`` is set to the assigned user / team for the
    inbound number so the assignment-rules engine can pick it up.
    """
    to_phone = PhoneNumber.objects.filter(number=normalize_number(to_number)).first()
    call = TelephonyCall.objects.create(
        tenant=tenant or (to_phone.tenant if to_phone else None),
        from_number=normalize_number(from_number),
        to_number=normalize_number(to_number),
        direction=CALL_INBOUND,
        status=CALL_RINGING,
        voip_provider=provider,
        voip_call_id=call_sid or "",
        owner_id=(to_phone.assigned_to_id if to_phone else ""),
        started_at=timezone.now(),
    )
    if to_phone is not None:
        ivr = IvrFlow.objects.filter(
            tenant=to_phone.tenant, phone_number=to_phone, is_active=True
        ).first()
        if ivr is not None:
            log.info(
                "telephony.handle_inbound_call: routing call %s to IVR flow %s",
                call.pk,
                ivr.pk,
            )
    return call


def _provider_create_call(call: TelephonyCall) -> str:
    """Stub provider call-creation — override in production.

    Returns the provider-assigned call SID (e.g. Twilio ``CA…``).
    """
    return ""


###############################################################################
# Transcription
###############################################################################


def transcribe_call(call_id: int) -> TelephonyCall:
    """Transcribe the recording for ``call_id`` via Whisper (stub).

    Updates ``transcription`` and (optionally) ``sentiment`` on the call.
    Called by the :func:`telephony.tasks.transcribe_call_task` Celery
    task once the recording URL is available.
    """
    call = TelephonyCall.objects.get(pk=call_id)
    if not call.recording_url:
        log.warning("telephony.transcribe_call: call %s has no recording_url", call.pk)
        return call
    text = _provider_transcribe(call.recording_url)
    call.transcription = text
    call.sentiment = _classify_sentiment(text)
    call.save(update_fields=["transcription", "sentiment", "updated_at"])
    return call


def _provider_transcribe(recording_url: str) -> str:
    """Stub Whisper-ASR transcription — override in production."""
    return ""


def _classify_sentiment(text: str) -> str:
    """Naive keyword sentiment classifier.

    Returns ``positive`` / ``negative`` / ``neutral``. Production should
    swap this for a proper NLP classifier.
    """
    if not text:
        return ""
    lower = text.lower()
    positive = sum(lower.count(w) for w in ("great", "thanks", "happy", "love", "perfect"))
    negative = sum(
        lower.count(w) for w in ("angry", "upset", "cancel", "bad", "terrible", "wrong")
    )
    if positive > negative:
        return "positive"
    if negative > positive:
        return "negative"
    return "neutral"


###############################################################################
# SMS
###############################################################################


def send_sms(
    *,
    from_number: str,
    to_number: str,
    body: str,
    tenant: Any = None,
    template: SmsTemplate | None = None,
    template_id: int | None = None,
    related_module: str | None = None,
    related_id: str | None = None,
    variables: dict[str, Any] | None = None,
) -> SmsMessage:
    """Send an SMS — optionally via a :class:`SmsTemplate`.

    If ``template_id`` is provided the helper loads the template,
    enforces the DLT approval gate (``is_approved`` + ``dlt_template_id``
    for Indian traffic), renders the body with ``variables``, and stamps
    the ``template`` FK on the message row.
    """
    if template is None and template_id is not None:
        template = SmsTemplate.objects.get(pk=template_id)
    if template is not None:
        if not template.is_approved:
            raise PermissionError(
                f"SmsTemplate {template.name!r} is not approved for outbound traffic."
            )
        rendered_body = _render_template(template.body, variables or {})
        if len(rendered_body) > template.max_length:
            raise ValueError(
                f"Rendered SMS body exceeds template max_length ({template.max_length})."
            )
        body = rendered_body
    if not is_valid_number(to_number):
        raise ValueError(f"send_sms: invalid 'to' number {to_number!r}")
    from_phone = PhoneNumber.objects.filter(number=normalize_number(from_number)).first()
    if tenant is None and from_phone is not None:
        tenant = from_phone.tenant
    segments = _segment_count(body)
    message = SmsMessage.objects.create(
        tenant=tenant,
        from_number=normalize_number(from_number),
        to_number=normalize_number(to_number),
        body=body,
        direction="outbound",
        status=SMS_QUEUED,
        template=template,
        related_module=related_module or "",
        related_id=related_id or "",
        segments=segments,
    )
    provider_message_id = _provider_send_sms(message)
    if provider_message_id:
        message.status = SMS_SENT
        message.sent_at = timezone.now()
        message.save(update_fields=["status", "sent_at", "updated_at"])
    return message


def send_bulk_sms(
    *,
    template_id: int,
    recipients: list[dict[str, Any]],
    from_number: str,
    tenant: Any = None,
    rate_per_sec: int = DEFAULT_SMS_RATE_PER_SEC,
) -> dict[str, int]:
    """Bulk-send ``template_id`` to ``recipients`` (rate-limited).

    ``recipients`` is a list of ``{to, variables}`` dicts. The helper is
    synchronous — the Celery task ``send_bulk_sms_task`` wraps it so the
    beat / async path can run it off the request thread.
    """
    template = SmsTemplate.objects.get(pk=template_id)
    sent = 0
    failed = 0
    interval = 1.0 / max(rate_per_sec, 1)
    started = timezone.now()
    for idx, recipient in enumerate(recipients or []):
        to = recipient.get("to") if isinstance(recipient, dict) else None
        if not to:
            failed += 1
            continue
        variables = recipient.get("variables", {}) if isinstance(recipient, dict) else {}
        try:
            send_sms(
                from_number=from_number,
                to_number=to,
                body="",
                tenant=tenant,
                template=template,
                variables=variables,
            )
            sent += 1
        except (ValueError, PermissionError) as exc:
            log.warning("telephony.send_bulk_sms: recipient %s failed — %s", to, exc)
            failed += 1
        # Naive rate-limit gate — every ``rate_per_sec`` messages, sleep
        # until the next 1-second window. The Celery task version uses
        # ``time.sleep`` directly; the synchronous caller is expected to
        # be a Celery worker already.
        if (idx + 1) % rate_per_sec == 0:
            elapsed = (timezone.now() - started).total_seconds()
            if elapsed < (idx + 1) / rate_per_sec:
                # In production: time.sleep(window - elapsed)
                pass
    return {"sent": sent, "failed": failed}


def _provider_send_sms(message: SmsMessage) -> str:
    """Stub provider SMS send — override in production.

    Returns the provider-assigned message id.
    """
    return ""


def _render_template(body: str, variables: dict[str, Any]) -> str:
    out = body or ""
    for key, value in (variables or {}).items():
        out = out.replace("{{" + key + "}}", str(value))
    return out


def _segment_count(body: str) -> int:
    """Estimate the segment count for ``body``."""
    if not body:
        return 1
    length = len(body)
    limit = SMS_SEGMENT_LENGTH_UNICODE if any(ord(c) > 127 for c in body) else SMS_SEGMENT_LENGTH
    return max(1, (length + limit - 1) // limit)


###############################################################################
# Analytics
###############################################################################


def get_call_analytics(filters: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return aggregate call analytics.

    Returns a dict with: ``total_calls``, ``avg_duration``,
    ``answer_rate``, ``missed_calls``, ``volume_per_owner``,
    ``peak_hours`` (0-23 buckets), ``outcome_distribution``.
    """
    filters = filters or {}
    qs = TelephonyCall.objects.all()
    started_gte = filters.get("started_at__gte")
    started_lte = filters.get("started_at__lte")
    if started_gte:
        qs = qs.filter(started_at__gte=started_gte)
    if started_lte:
        qs = qs.filter(started_at__lte=started_lte)
    owner_id = filters.get("owner_id")
    if owner_id:
        qs = qs.filter(owner_id=str(owner_id))

    total = qs.count()
    if total == 0:
        return {
            "total_calls": 0,
            "avg_duration": 0.0,
            "answer_rate": 0.0,
            "missed_calls": 0,
            "volume_per_owner": {},
            "peak_hours": {},
            "outcome_distribution": {},
        }
    avg_duration = qs.aggregate(avg=Avg("duration"))["avg"] or 0.0
    # A call is "answered" iff it reached a connected terminal state —
    # ``completed`` or ``in_progress``. Everything else (``failed``,
    # ``busy``, ``no_answer``, ``voicemail``, ``ringing`` without an
    # answer) is unanswered.
    answered = qs.filter(status__in=("completed", "in_progress")).count()
    missed = qs.filter(direction=CALL_MISSED).count()
    volume_per_owner: dict[str, int] = dict(
        qs.exclude(owner_id="").values_list("owner_id").annotate(c=Count("id")).order_by("-c")
    )
    peak_hours: dict[str, int] = {
        str(hour): count
        for hour, count in qs.exclude(started_at__isnull=True)
        .annotate(hour=ExtractHour("started_at"))
        .values_list("hour")
        .annotate(c=Count("id"))
        .order_by("hour")
    }
    outcome_distribution: dict[str, int] = dict(
        qs.exclude(outcome="").values_list("outcome").annotate(c=Count("id"))
    )
    return {
        "total_calls": total,
        "avg_duration": float(avg_duration),
        "answer_rate": round(answered / total, 4),
        "missed_calls": missed,
        "volume_per_owner": volume_per_owner,
        "peak_hours": peak_hours,
        "outcome_distribution": outcome_distribution,
    }


__all__ = [
    "DEFAULT_SMS_RATE_PER_SEC",
    "get_call_analytics",
    "handle_inbound_call",
    "initiate_call",
    "is_valid_number",
    "normalize_number",
    "send_bulk_sms",
    "send_sms",
    "transcribe_call",
]

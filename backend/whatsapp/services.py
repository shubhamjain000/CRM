"""Service layer for the whatsapp app.

Provider glue (Meta Graph API for WhatsApp Business) is stubbed behind
the ``_graph_api_send`` hook — the production deployment wires the real
``requests.post`` there. The service layer is provider-agnostic so the
rest of the app (tests, viewsets, tasks) doesn't need to know whether
we're hitting Graph API v18 or v19, or whether the request is proxied.
"""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING, Any

from django.utils import timezone

from .models import (
    DIR_INBOUND,
    DIR_OUTBOUND,
    MSG_TEXT,
    ST_DELIVERED,
    ST_FAILED,
    ST_PENDING,
    ST_SENT,
    WhatsAppAccount,
    WhatsAppMessage,
    WhatsAppTemplate,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from files.models import File

log = logging.getLogger(__name__)


###############################################################################
# Outbound send
###############################################################################


def send_message(
    account: WhatsAppAccount,
    to: str,
    body: str | None = None,
    media: "File | None" = None,
    *,
    related_module: str | None = None,
    related_id: str | None = None,
) -> WhatsAppMessage:
    """Send a text or media message from ``account`` to ``to``.

    Exactly one of ``body`` / ``media`` must be supplied. Creates a
    :class:`WhatsAppMessage` row in ``pending`` state, calls the
    stubbed :func:`_graph_api_send` hook, and stamps ``status=sent``
    on success (or ``failed`` + error fields on failure).
    """
    if not body and media is None:
        raise ValueError("send_message: 'body' or 'media' is required.")
    message = WhatsAppMessage.objects.create(
        tenant=account.tenant,
        account=account,
        from_phone=account.display_phone_number,
        to_phone=to,
        body=body or "",
        media_file=media,
        message_type=MSG_TEXT if body else "image",
        direction=DIR_OUTBOUND,
        status=ST_PENDING,
        related_module=related_module or "",
        related_id=related_id or "",
        timestamp=timezone.now(),
    )
    payload = _build_send_payload(account, message, body, media)
    try:
        response = _graph_api_send(account, payload)
    except Exception as exc:  # pragma: no cover — defensive
        message.status = ST_FAILED
        message.error_code = "EXCEPTION"
        message.error_message = str(exc)
        message.save(update_fields=["status", "error_code", "error_message", "updated_at"])
        log.exception("whatsapp.send_message: graph api send failed for %s", message.pk)
        return message
    if isinstance(response, dict) and response.get("error"):
        message.status = ST_FAILED
        message.error_code = str(response["error"].get("code", ""))
        message.error_message = str(response["error"].get("message", ""))
    else:
        message.status = ST_SENT
    message.save(update_fields=["status", "error_code", "error_message", "updated_at"])
    log.info("whatsapp.send_message: sent message %s to %s", message.pk, to)
    return message


def send_template(
    account: WhatsAppAccount,
    to: str,
    template_name: str,
    variables: list[dict[str, Any]] | None = None,
    *,
    language: str | None = None,
    related_module: str | None = None,
    related_id: str | None = None,
) -> WhatsAppMessage:
    """Send a pre-approved template message.

    Looks up the :class:`WhatsAppTemplate` by ``template_name`` (and
    optional ``language``); raises :class:`ValueError` if no approved
    template is found. ``variables`` is a list of parameter objects in
    Meta's ``components[].parameters[]`` shape.
    """
    template = WhatsAppTemplate.objects.filter(
        tenant=account.tenant,
        name=template_name,
        is_approved=True,
    ).first()
    if template is None:
        raise ValueError(f"send_template: no approved template named {template_name!r}.")
    lang = language or template.language
    message = WhatsAppMessage.objects.create(
        tenant=account.tenant,
        account=account,
        from_phone=account.display_phone_number,
        to_phone=to,
        body=template.body,
        message_type="template",
        direction=DIR_OUTBOUND,
        status=ST_PENDING,
        template_id=template.template_id,
        related_module=related_module or "",
        related_id=related_id or "",
        timestamp=timezone.now(),
    )
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "template",
        "template": {
            "name": template.name,
            "language": {"code": lang},
            "components": [
                {"type": "body", "parameters": variables or []},
            ],
        },
    }
    try:
        response = _graph_api_send(account, payload)
    except Exception as exc:  # pragma: no cover — defensive
        message.status = ST_FAILED
        message.error_code = "EXCEPTION"
        message.error_message = str(exc)
        message.save(update_fields=["status", "error_code", "error_message", "updated_at"])
        return message
    if isinstance(response, dict) and response.get("error"):
        message.status = ST_FAILED
        message.error_code = str(response["error"].get("code", ""))
        message.error_message = str(response["error"].get("message", ""))
    else:
        message.status = ST_SENT
    message.save(update_fields=["status", "error_code", "error_message", "updated_at"])
    return message


def broadcast(
    account: WhatsAppAccount,
    recipients: list[str],
    template_name: str,
    variables: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Send the same template to ``recipients`` — best-effort per-recipient.

    Per-recipient failures are isolated (one bad number doesn't abort the
    batch). Returns ``{"sent": [...], "failed": [...]}`` with per-recipient
    message PKs.
    """
    sent: list[int] = []
    failed: list[dict[str, Any]] = []
    for to in recipients:
        try:
            msg = send_template(account, to, template_name, variables)
        except ValueError as exc:
            failed.append({"to": to, "error": str(exc)})
            continue
        if msg.status == ST_FAILED:
            failed.append({"to": to, "error": msg.error_message})
        else:
            sent.append(msg.pk)
    return {"sent": sent, "failed": failed}


###############################################################################
# Inbound webhook ingest
###############################################################################


def handle_webhook(payload: dict[str, Any]) -> list[WhatsAppMessage]:
    """Ingest an inbound webhook payload from Meta.

    The payload shape (per Meta's WhatsApp Business API docs) is::

        {"entry": [{"changes": [{"value": {
            "messaging_product": "whatsapp",
            "metadata": {"phone_number_id": "..."},
            "messages": [{"from": "...", "id": "...", "text": {"body": "..."}, ...}],
            "statuses": [{"id": "...", "status": "delivered", ...}],
        }}]}]}

    Creates :class:`WhatsAppMessage` rows for inbound messages and
    updates status on existing outbound messages for status callbacks.
    Returns the list of newly-created inbound messages.
    """
    created: list[WhatsAppMessage] = []
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            phone_number_id = (value.get("metadata") or {}).get("phone_number_id", "")
            account = WhatsAppAccount.objects.filter(phone_number_id=phone_number_id).first()
            if account is None:
                continue
            for raw in value.get("messages") or []:
                msg = _ingest_inbound_message(account, raw)
                if msg is not None:
                    created.append(msg)
            for raw in value.get("statuses") or []:
                _apply_status_callback(account, raw)
    return created


def _ingest_inbound_message(
    account: WhatsAppAccount, raw: dict[str, Any]
) -> WhatsAppMessage | None:
    """Create an :class:`WhatsAppMessage` row from a single inbound payload."""
    from_phone = str(raw.get("from", ""))
    if not from_phone:
        return None
    text_obj = raw.get("text") or {}
    return WhatsAppMessage.objects.create(
        tenant=account.tenant,
        account=account,
        from_phone=from_phone,
        to_phone=account.display_phone_number,
        body=str(text_obj.get("body", "")),
        message_type=str(raw.get("type", MSG_TEXT)),
        direction=DIR_INBOUND,
        status=ST_DELIVERED,
        timestamp=timezone.now(),
    )


def _apply_status_callback(account: WhatsAppAccount, raw: dict[str, Any]) -> None:
    """Update an outbound message's status from a Meta status webhook."""
    message_wamid = str(raw.get("id", ""))
    new_status = str(raw.get("status", "")).lower()
    if not message_wamid or not new_status:
        return
    # We don't currently persist Meta's wamid on the row; instead we update
    # the most-recent pending outbound message to this recipient.
    msg = (
        WhatsAppMessage.objects.filter(
            tenant=account.tenant,
            to_phone=str(raw.get("recipient_id", "")),
            direction=DIR_OUTBOUND,
        )
        .order_by("-timestamp")
        .first()
    )
    if msg is None or msg.status in (ST_DELIVERED, ST_READ):
        return
    if new_status in (ST_SENT, ST_DELIVERED, ST_READ, ST_FAILED):
        msg.status = new_status
        if new_status == ST_FAILED:
            msg.error_code = str(raw.get("errors", [{}])[0].get("code", "")) if raw.get(
                "errors"
            ) else ""
            msg.error_message = str(raw.get("errors", [{}])[0].get("title", "")) if raw.get(
                "errors"
            ) else ""
        msg.save(update_fields=["status", "error_code", "error_message", "updated_at"])


###############################################################################
# Provider stubs
###############################################################################


def _build_send_payload(
    account: WhatsAppAccount,
    message: WhatsAppMessage,
    body: str | None,
    media: "File | None",
) -> dict[str, Any]:
    """Build the Meta Graph API request body for a single send."""
    if media is not None:
        return {
            "messaging_product": "whatsapp",
            "to": message.to_phone,
            "type": "image" if "image" in (media.mime_type or "") else "document",
            "image": {"id": str(media.pk), "caption": body or ""},
        }
    return {
        "messaging_product": "whatsapp",
        "to": message.to_phone,
        "type": "text",
        "text": {"body": body or "", "preview_url": False},
    }


def _graph_api_send(account: WhatsAppAccount, payload: dict[str, Any]) -> dict[str, Any]:
    """Stub Meta Graph API sender — override in production.

    Returns a dict shaped like ``{"messages": [{"id": "..."}]}`` on
    success, or ``{"error": {"code": "...", "message": "..."}}`` on
    failure.
    """
    return {"messages": [{"id": f"wamid.{uuid.uuid4()}"}]}


__all__ = [
    "broadcast",
    "handle_webhook",
    "send_message",
    "send_template",
]

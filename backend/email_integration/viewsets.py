"""DRF ViewSets for the email_integration app.

* :class:`EmailAccountViewSet` — CRUD on connected mailboxes.
* :class:`EmailViewSet` — list / retrieve / create emails plus the
  ``send`` / ``star`` / ``snooze`` / ``mark_read`` / ``thread`` actions.
* :class:`EmailThreadViewSet` — read-only thread list with a ``emails``
  detail action that returns the thread's messages.
* :class:`EmailSignatureViewSet` — CRUD on per-user signatures.
* :class:`MailMergeCampaignViewSet` — CRUD + ``start`` / ``preview``.
"""

from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember
from email_integration.filters import (
    EmailAccountFilter,
    EmailFilter,
    EmailThreadFilter,
    MailMergeCampaignFilter,
)
from email_integration.models import Email, EmailAccount, EmailSignature, EmailThread, MailMergeCampaign
from email_integration.serializers import (
    EmailAccountSerializer,
    EmailSerializer,
    EmailSignatureSerializer,
    EmailThreadSerializer,
    MailMergeCampaignSerializer,
)
from email_integration.services import (
    handle_bounce,
    render_template,
    send_email,
    sync_imap,
    undo_send,
)


###############################################################################
# EmailAccountViewSet
###############################################################################


class EmailAccountViewSet(ModelViewSet):
    """CRUD on :class:`EmailAccount`. Writes require ``email.manage``."""

    pagination_class = CRMCursorPagination
    serializer_class = EmailAccountSerializer
    filterset_class = EmailAccountFilter
    queryset = EmailAccount.objects.select_related("tenant", "user")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "sync"):
            return [IsAuthenticated(), IsTenantMember()]
        return [
            IsAuthenticated(),
            IsTenantMember(),
            HasPermission("email.manage"),
        ]

    def perform_create(self, serializer: EmailAccountSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant, user=self.request.user)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="sync")
    def sync(self, request: Request, pk: str | None = None) -> Response:
        """Trigger an immediate IMAP sync for this account."""
        account: EmailAccount = self.get_object()  # type: ignore[assignment]
        created = sync_imap(account)
        return Response(
            {"synced": len(created), "message_ids": [e.pk for e in created]}
        )


###############################################################################
# EmailViewSet
###############################################################################


class EmailViewSet(ModelViewSet):
    """List / retrieve / create :class:`Email` plus lifecycle actions.

    * ``POST /emails/{id}/send/`` — send a draft immediately or with
      ``scheduled_at`` for schedule-send.
    * ``POST /emails/{id}/star/`` — toggle ``is_starred``.
    * ``POST /emails/{id}/snooze/`` — set ``snoozed_until``.
    * ``POST /emails/{id}/mark_read/`` — clear ``snoozed_until`` + add
      ``read`` label.
    * ``GET /emails/{id}/thread/`` — return all emails in the same thread.
    * ``POST /emails/{id}/undo_send/`` — Gmail-style 5s undo window.
    """

    pagination_class = CRMCursorPagination
    serializer_class = EmailSerializer
    filterset_class = EmailFilter
    queryset = Email.objects.select_related("tenant", "account", "thread")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "thread"):
            return [IsAuthenticated(), IsTenantMember()]
        return [
            IsAuthenticated(),
            IsTenantMember(),
            HasPermission("email.manage"),
        ]

    def perform_create(self, serializer: EmailSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="send")
    def send(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{to, subject, body_html, cc, bcc, attachments, scheduled_at}``.

        If the email is being composed from scratch (no persisted row),
        pass ``account_id`` in the body — the service creates the row.
        """
        account_id = request.data.get("account_id")
        account = EmailAccount.objects.filter(
            tenant=request.tenant,  # type: ignore[attr-defined]
            pk=account_id,
            is_active=True,
        ).first()
        if account is None:
            return Response(
                {"detail": "A valid active account_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            email = send_email(
                account=account,
                to=request.data.get("to") or [],
                subject=request.data.get("subject", ""),
                body_html=request.data.get("body_html", ""),
                attachments=request.data.get("attachments"),
                cc=request.data.get("cc"),
                bcc=request.data.get("bcc"),
                scheduled_at=request.data.get("scheduled_at"),
                user=request.user,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(EmailSerializer(email).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="star")
    def star(self, request: Request, pk: str | None = None) -> Response:
        email: Email = self.get_object()  # type: ignore[assignment]
        email.is_starred = not email.is_starred
        email.save(update_fields=["is_starred", "updated_at"])
        return Response(EmailSerializer(email).data)

    @action(detail=True, methods=["post"], url_path="snooze")
    def snooze(self, request: Request, pk: str | None = None) -> Response:
        email: Email = self.get_object()  # type: ignore[assignment]
        until = request.data.get("snoozed_until")
        if not until:
            return Response(
                {"detail": "snoozed_until is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        email.snoozed_until = until
        email.save(update_fields=["snoozed_until", "updated_at"])
        return Response(EmailSerializer(email).data)

    @action(detail=True, methods=["post"], url_path="mark_read")
    def mark_read(self, request: Request, pk: str | None = None) -> Response:
        email: Email = self.get_object()  # type: ignore[assignment]
        email.snoozed_until = None
        labels = list(email.labels or [])
        if "read" not in labels:
            labels.append("read")
        email.labels = labels
        email.save(update_fields=["snoozed_until", "labels", "updated_at"])
        return Response(EmailSerializer(email).data)

    @action(detail=True, methods=["get"], url_path="thread")
    def thread(self, request: Request, pk: str | None = None) -> Response:
        email: Email = self.get_object()  # type: ignore[assignment]
        if email.thread_id is None:
            return Response([])
        qs = Email.objects.filter(tenant=email.tenant, thread=email.thread).order_by(
            "received_at", "sent_at"
        )
        return Response(EmailSerializer(qs, many=True).data)

    @action(detail=True, methods=["post"], url_path="undo_send")
    def undo_send_action(self, request: Request, pk: str | None = None) -> Response:
        email: Email = self.get_object()  # type: ignore[assignment]
        reverted = undo_send(email.pk)
        if reverted.status == "draft":
            return Response(EmailSerializer(reverted).data)
        return Response(
            {"detail": "Undo window has elapsed."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    @action(detail=True, methods=["post"], url_path="bounce")
    def bounce(self, request: Request, pk: str | None = None) -> Response:
        """Mark an email as bounced (called by webhook from the ESP)."""
        email: Email = self.get_object()  # type: ignore[assignment]
        reason = request.data.get("reason", "")
        handle_bounce(email.pk, reason)
        email.refresh_from_db()
        return Response(EmailSerializer(email).data)


###############################################################################
# EmailThreadViewSet
###############################################################################


class EmailThreadViewSet(ReadOnlyModelViewSet):
    """Read-only list / retrieve for :class:`EmailThread`."""

    pagination_class = CRMCursorPagination
    serializer_class = EmailThreadSerializer
    filterset_class = EmailThreadFilter
    permission_classes = [IsAuthenticated, IsTenantMember]
    queryset = EmailThread.objects.select_related("tenant")

    @action(detail=True, methods=["get"], url_path="emails")
    def emails(self, request: Request, pk: str | None = None) -> Response:
        thread: EmailThread = self.get_object()  # type: ignore[assignment]
        qs = Email.objects.filter(tenant=thread.tenant, thread=thread).order_by(
            "received_at", "sent_at"
        )
        return Response(EmailSerializer(qs, many=True).data)


###############################################################################
# EmailSignatureViewSet
###############################################################################


class EmailSignatureViewSet(ModelViewSet):
    """CRUD on :class:`EmailSignature`."""

    pagination_class = CRMCursorPagination
    serializer_class = EmailSignatureSerializer
    queryset = EmailSignature.objects.select_related("tenant", "user")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("email.manage")]

    def perform_create(self, serializer: EmailSignatureSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant, user=self.request.user)  # type: ignore[attr-defined]


###############################################################################
# MailMergeCampaignViewSet
###############################################################################


class MailMergeCampaignViewSet(ModelViewSet):
    """CRUD on :class:`MailMergeCampaign` plus ``start`` / ``preview``."""

    pagination_class = CRMCursorPagination
    serializer_class = MailMergeCampaignSerializer
    filterset_class = MailMergeCampaignFilter
    queryset = MailMergeCampaign.objects.select_related("tenant", "created_by")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "preview"):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("email.manage")]

    def perform_create(self, serializer: MailMergeCampaignSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant, created_by=self.request.user)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="start")
    def start(self, request: Request, pk: str | None = None) -> Response:
        """Kick off the bulk send asynchronously."""
        from email_integration.tasks import send_mail_merge_campaign  # noqa: PLC0415

        campaign: MailMergeCampaign = self.get_object()  # type: ignore[assignment]
        send_mail_merge_campaign.delay(campaign.pk)
        return Response({"status": "queued", "campaign_id": campaign.pk})

    @action(detail=True, methods=["post"], url_path="preview")
    def preview(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{variables}`` → rendered subject + body for inspection."""
        campaign: MailMergeCampaign = self.get_object()  # type: ignore[assignment]
        variables = request.data.get("variables") or {}
        return Response(
            {
                "subject": render_template(campaign.template_subject, variables),
                "body_html": render_template(campaign.template_body_html, variables),
            }
        )


__all__ = [
    "EmailAccountViewSet",
    "EmailSignatureViewSet",
    "EmailThreadViewSet",
    "EmailViewSet",
    "MailMergeCampaignViewSet",
]

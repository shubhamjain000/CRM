"""DRF ViewSets for the whatsapp app.

* :class:`WhatsAppAccountViewSet` — CRUD on connected WhatsApp numbers.
* :class:`WhatsAppMessageViewSet` — list / retrieve + ``send`` (single
  text / media message) + ``broadcast`` (template to many recipients).
* :class:`WhatsAppTemplateViewSet` — CRUD on pre-approved templates.
"""

from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember
from whatsapp.filters import (
    WhatsAppAccountFilter,
    WhatsAppMessageFilter,
    WhatsAppTemplateFilter,
)
from whatsapp.models import WhatsAppAccount, WhatsAppMessage, WhatsAppTemplate
from whatsapp.serializers import (
    WhatsAppAccountSerializer,
    WhatsAppMessageSerializer,
    WhatsAppTemplateSerializer,
)
from whatsapp.services import broadcast as broadcast_fn
from whatsapp.services import send_message, send_template


def _get_perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "messages"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("whatsapp.manage")]


###############################################################################
# WhatsAppAccountViewSet
###############################################################################


class WhatsAppAccountViewSet(ModelViewSet):
    """CRUD on :class:`WhatsAppAccount`. Writes require ``whatsapp.manage``."""

    pagination_class = CRMCursorPagination
    serializer_class = WhatsAppAccountSerializer
    filterset_class = WhatsAppAccountFilter
    queryset = WhatsAppAccount.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _get_perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: WhatsAppAccountSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


###############################################################################
# WhatsAppMessageViewSet
###############################################################################


class WhatsAppMessageViewSet(ModelViewSet):
    """List / retrieve + ``send`` / ``broadcast`` actions."""

    pagination_class = CRMCursorPagination
    serializer_class = WhatsAppMessageSerializer
    filterset_class = WhatsAppMessageFilter
    queryset = WhatsAppMessage.objects.select_related("tenant", "account", "media_file")

    def get_permissions(self) -> Any:
        return _get_perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: WhatsAppMessageSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=False, methods=["post"], url_path="send")
    def send(self, request: Request) -> Response:
        """POST ``{account_id, to, body?, media_file_id?}``.

        Dispatches via :func:`whatsapp.services.send_message` and
        returns the created :class:`WhatsAppMessage` row.
        """
        account = self._resolve_account(request)
        if account is None:
            return Response(
                {"detail": "A valid active account_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            msg = send_message(
                account=account,
                to=request.data.get("to", ""),
                body=request.data.get("body"),
                media=self._resolve_media(request),
                related_module=request.data.get("related_module"),
                related_id=request.data.get("related_id"),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(WhatsAppMessageSerializer(msg).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="broadcast")
    def broadcast(self, request: Request) -> Response:
        """POST ``{account_id, recipients: [..], template_name, variables?}``.

        Sends the same approved template to every recipient; returns
        per-recipient sent / failed breakdown.
        """
        account = self._resolve_account(request)
        if account is None:
            return Response(
                {"detail": "A valid active account_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        recipients = request.data.get("recipients") or []
        template_name = request.data.get("template_name")
        if not recipients or not template_name:
            return Response(
                {"detail": "recipients and template_name are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            result = broadcast_fn(
                account=account,
                recipients=recipients,
                template_name=template_name,
                variables=request.data.get("variables"),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="send_template")
    def send_template_action(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{account_id, to, template_name, variables?, language?}``."""
        account = self._resolve_account(request)
        if account is None:
            return Response(
                {"detail": "A valid active account_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            msg = send_template(
                account=account,
                to=request.data.get("to", ""),
                template_name=request.data.get("template_name", ""),
                variables=request.data.get("variables"),
                language=request.data.get("language"),
                related_module=request.data.get("related_module"),
                related_id=request.data.get("related_id"),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(WhatsAppMessageSerializer(msg).data, status=status.HTTP_201_CREATED)

    def _resolve_account(self, request: Request) -> WhatsAppAccount | None:
        account_id = request.data.get("account_id")
        if account_id is None:
            return None
        return WhatsAppAccount.objects.filter(
            tenant=request.tenant,  # type: ignore[attr-defined]
            pk=account_id,
            is_active=True,
        ).first()

    def _resolve_media(self, request: Request) -> Any:
        media_file_id = request.data.get("media_file_id")
        if media_file_id is None:
            return None
        try:
            from files.models import File  # noqa: PLC0415 — lazy import
        except Exception:  # pragma: no cover — files app always present
            return None
        return File.objects.filter(pk=media_file_id).first()


###############################################################################
# WhatsAppTemplateViewSet
###############################################################################


class WhatsAppTemplateViewSet(ModelViewSet):
    """CRUD on :class:`WhatsAppTemplate`. Writes require ``whatsapp.manage``."""

    pagination_class = CRMCursorPagination
    serializer_class = WhatsAppTemplateSerializer
    filterset_class = WhatsAppTemplateFilter
    queryset = WhatsAppTemplate.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _get_perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: WhatsAppTemplateSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


__all__ = [
    "WhatsAppAccountViewSet",
    "WhatsAppMessageViewSet",
    "WhatsAppTemplateViewSet",
]

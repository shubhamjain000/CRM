"""DRF ViewSets for the telephony app.

* :class:`PhoneNumberViewSet` — CRUD on rented numbers.
* :class:`TelephonyCallViewSet` — list / retrieve / create calls plus
  ``click_to_call`` / ``transcription`` / ``analytics`` actions.
* :class:`SmsTemplateViewSet` — CRUD on SMS templates (DLT approval gate).
* :class:`SmsMessageViewSet` — list / retrieve + ``send`` / ``bulk_send``.
* :class:`IvrFlowViewSet` — CRUD on IVR flow definitions.
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
from api.permissions import HasPermission, IsOrgAdmin, IsTenantMember
from telephony.filters import (
    IvrFlowFilter,
    PhoneNumberFilter,
    SmsMessageFilter,
    SmsTemplateFilter,
    TelephonyCallFilter,
)
from telephony.models import (
    IvrFlow,
    PhoneNumber,
    SmsMessage,
    SmsTemplate,
    TelephonyCall,
)
from telephony.serializers import (
    IvrFlowSerializer,
    PhoneNumberSerializer,
    SmsMessageSerializer,
    SmsTemplateSerializer,
    TelephonyCallSerializer,
)
from telephony.services import (
    get_call_analytics,
    initiate_call,
    send_sms,
    transcribe_call,
)


###############################################################################
# PhoneNumberViewSet
###############################################################################


class PhoneNumberViewSet(ModelViewSet):
    """CRUD on :class:`PhoneNumber`. Writes require ``telephony.manage``."""

    pagination_class = CRMCursorPagination
    serializer_class = PhoneNumberSerializer
    filterset_class = PhoneNumberFilter
    queryset = PhoneNumber.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("telephony.manage")]

    def perform_create(self, serializer: PhoneNumberSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


###############################################################################
# TelephonyCallViewSet
###############################################################################


class TelephonyCallViewSet(ModelViewSet):
    """List / retrieve / create :class:`TelephonyCall` plus lifecycle actions."""

    pagination_class = CRMCursorPagination
    serializer_class = TelephonyCallSerializer
    filterset_class = TelephonyCallFilter
    queryset = TelephonyCall.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "analytics"):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("telephony.manage")]

    def perform_create(self, serializer: TelephonyCallSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=False, methods=["post"], url_path="click_to_call")
    def click_to_call(self, request: Request) -> Response:
        """POST ``{from_number, to_number, related_module?, related_id?}``.

        Initiates an outbound call leg via :func:`telephony.services.initiate_call`.
        """
        from_number = request.data.get("from_number")
        to_number = request.data.get("to_number")
        if not from_number or not to_number:
            return Response(
                {"detail": "from_number and to_number are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            call = initiate_call(
                from_number=from_number,
                to_number=to_number,
                tenant=request.tenant,  # type: ignore[attr-defined]
                related_module=request.data.get("related_module"),
                related_id=request.data.get("related_id"),
                owner_id=str(request.user.pk),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(TelephonyCallSerializer(call).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="transcription")
    def transcription(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{}`` → transcribe the call's recording (synchronously)."""
        call: TelephonyCall = self.get_object()  # type: ignore[assignment]
        transcribe_call(call.pk)
        call.refresh_from_db()
        return Response(TelephonyCallSerializer(call).data)

    @action(detail=False, methods=["get"], url_path="analytics")
    def analytics(self, request: Request) -> Response:
        """GET ``?started_at__gte=…&started_at__lte=…&owner_id=…`` → aggregates."""
        filters: dict[str, Any] = {}
        for key in ("started_at__gte", "started_at__lte", "owner_id"):
            value = request.query_params.get(key)
            if value:
                filters[key] = value
        return Response(get_call_analytics(filters))


###############################################################################
# SmsTemplateViewSet
###############################################################################


class SmsTemplateViewSet(ModelViewSet):
    """CRUD on :class:`SmsTemplate`.

    The ``approve`` action requires org admin (DLT compliance gate).
    """

    pagination_class = CRMCursorPagination
    serializer_class = SmsTemplateSerializer
    filterset_class = SmsTemplateFilter
    queryset = SmsTemplate.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsTenantMember()]
        if self.action == "approve":
            return [IsAuthenticated(), IsTenantMember(), IsOrgAdmin()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("telephony.manage")]

    def perform_create(self, serializer: SmsTemplateSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request: Request, pk: str | None = None) -> Response:
        """Toggle DLT approval (admin-only). Pass ``{dlt_template_id}`` to set."""
        template: SmsTemplate = self.get_object()  # type: ignore[assignment]
        dlt_id = request.data.get("dlt_template_id")
        if dlt_id:
            template.dlt_template_id = str(dlt_id)
        template.is_approved = bool(request.data.get("is_approved", True))
        template.save(update_fields=["is_approved", "dlt_template_id", "updated_at"])
        return Response(SmsTemplateSerializer(template).data)


###############################################################################
# SmsMessageViewSet
###############################################################################


class SmsMessageViewSet(ModelViewSet):
    """List / retrieve :class:`SmsMessage` plus ``send`` / ``bulk_send``."""

    pagination_class = CRMCursorPagination
    serializer_class = SmsMessageSerializer
    filterset_class = SmsMessageFilter
    queryset = SmsMessage.objects.select_related("tenant", "template")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("telephony.manage")]

    def perform_create(self, serializer: SmsMessageSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=False, methods=["post"], url_path="send")
    def send(self, request: Request) -> Response:
        """POST ``{from_number, to_number, body?, template_id?, variables?}``.

        Either ``body`` or ``template_id`` must be supplied. When a
        template is used, the DLT approval gate is enforced by
        :func:`telephony.services.send_sms`.
        """
        from_number = request.data.get("from_number")
        to_number = request.data.get("to_number")
        if not from_number or not to_number:
            return Response(
                {"detail": "from_number and to_number are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            message = send_sms(
                from_number=from_number,
                to_number=to_number,
                body=request.data.get("body", ""),
                tenant=request.tenant,  # type: ignore[attr-defined]
                template_id=request.data.get("template_id"),
                variables=request.data.get("variables"),
                related_module=request.data.get("related_module"),
                related_id=request.data.get("related_id"),
            )
        except (ValueError, PermissionError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(SmsMessageSerializer(message).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="bulk_send")
    def bulk_send(self, request: Request) -> Response:
        """POST ``{template_id, from_number, recipients}`` → async bulk send."""
        from telephony.tasks import send_bulk_sms_task  # noqa: PLC0415

        template_id = request.data.get("template_id")
        from_number = request.data.get("from_number")
        recipients = request.data.get("recipients")
        if not template_id or not from_number or not isinstance(recipients, list):
            return Response(
                {"detail": "template_id, from_number, recipients[] are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        send_bulk_sms_task.delay(
            template_id=int(template_id),
            recipients=recipients,
            from_number=from_number,
            tenant_id=request.tenant.pk,  # type: ignore[attr-defined]
        )
        return Response({"status": "queued", "recipients": len(recipients)})


###############################################################################
# IvrFlowViewSet
###############################################################################


class IvrFlowViewSet(ModelViewSet):
    """CRUD on :class:`IvrFlow`."""

    pagination_class = CRMCursorPagination
    serializer_class = IvrFlowSerializer
    filterset_class = IvrFlowFilter
    queryset = IvrFlow.objects.select_related("tenant", "phone_number")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("telephony.manage")]

    def perform_create(self, serializer: IvrFlowSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


__all__ = [
    "IvrFlowViewSet",
    "PhoneNumberViewSet",
    "SmsMessageViewSet",
    "SmsTemplateViewSet",
    "TelephonyCallViewSet",
]

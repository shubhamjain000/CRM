"""DRF ViewSet for the calls app.

Provides CRUD + the ``log_call`` quick-create action. Cursor pagination, sort
whitelist, and tenant scoping come from the shared
:class:`api.crm_base.CRMModelViewSet`.
"""

from __future__ import annotations

from typing import Any, Iterable

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from api.crm_base import CRMModelViewSet
from api.permissions import HasPermission, IsTenantMember
from calls.filters import CallFilter
from calls.models import Call
from calls.serializers import CallSerializer, LogCallSerializer


class CallViewSet(CRMModelViewSet):
    """CRUD + ``log_call`` for :class:`calls.models.Call`."""

    serializer_class = CallSerializer
    queryset = Call.objects.all().select_related("created_by")
    filterset_class = CallFilter
    sort_fields: tuple[str, ...] = (
        "id",
        "subject",
        "call_type",
        "outcome",
        "started_at",
        "ended_at",
        "duration",
        "created_at",
        "updated_at",
    )
    bulk_update_fields: tuple[str, ...] = (
        "outcome",
        "sentiment",
        "notes",
        "voip_provider",
    )
    required_permission: Iterable[str] | str = "crm.calls.read"

    def get_permissions(self) -> Any:
        method = self.request.method or ""
        if method in ("GET", "HEAD", "OPTIONS"):
            perm = "crm.calls.read"
        elif method == "POST":
            perm = "crm.calls.create"
        elif method in ("PUT", "PATCH"):
            perm = "crm.calls.update"
        elif method == "DELETE":
            perm = "crm.calls.delete"
        else:
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission(perm)]

    def perform_create(self, serializer: CallSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ log_call

    @action(detail=False, methods=["post"], url_path="log-call")
    def log_call(self, request: Request) -> Response:
        """Quick-create a call from a CRM record.

        Payload: see :class:`calls.serializers.LogCallSerializer`. The created
        call's ``attendee_ids`` defaults to ``[request.user.pk]`` if not
        provided so the agent is recorded as a participant.
        """
        serializer = LogCallSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        attendee_ids = data.pop("attendee_ids", None)
        if attendee_ids is None:
            attendee_ids = [request.user.pk]
        call = Call.objects.create(
            tenant=request.tenant,  # type: ignore[attr-defined]
            created_by=request.user,
            **data,
        )
        if attendee_ids:
            call.attendees.set(attendee_ids)
        return Response(
            CallSerializer(call, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

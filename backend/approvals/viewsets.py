"""DRF ViewSets for the approvals app.

Three viewsets expose the approval engine:

* :class:`ApprovalProcessViewSet` — CRUD on :class:`ApprovalProcess` plus
  a nested ``steps`` action for inspecting / creating the ordered step
  list. Writes require ``approvals.manage``; reads are open to any tenant
  member.
* :class:`ApprovalRequestViewSet` — list / retrieve on
  :class:`ApprovalRequest` plus the runtime actions ``approve``,
  ``reject``, ``delegate``, ``recall``, ``bulk_approve``, ``pending``
  (for the current user), and ``my_requests``.
* :class:`ApprovalDelegationViewSet` — CRUD on
  :class:`ApprovalDelegation`. A user may have at most one active
  delegation per date range — the viewset enforces a soft singleton per
  ``(user, start_date, end_date)`` triple via the model's clean() method.

All viewsets inherit :class:`api.crm_base.CRMCursorPagination` (page_size
50, max 200) and are scoped by :class:`api.managers.TenantManager`.
"""

from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember
from approvals.filters import (
    ApprovalDelegationFilter,
    ApprovalProcessFilter,
    ApprovalRequestFilter,
)
from approvals.models import (
    ApprovalDelegation,
    ApprovalProcess,
    ApprovalRequest,
)
from approvals.serializers import (
    ApprovalActionSerializer,
    ApprovalDelegationSerializer,
    ApprovalProcessSerializer,
    ApprovalRequestSerializer,
    ApprovalStepSerializer,
)
from approvals.services import ApprovalService


###############################################################################
# Helpers
###############################################################################


def _format_validation_error(exc: DjangoValidationError) -> dict[str, Any]:
    """Translate a Django ``ValidationError`` into a JSON-safe dict for DRF."""
    if hasattr(exc, "message_dict"):
        return exc.message_dict  # type: ignore[no-any-return]
    if isinstance(exc.messages, list):  # type: ignore[attr-defined]
        return {"detail": "; ".join(str(m) for m in exc.messages)}  # type: ignore[attr-defined]
    return {"detail": str(exc)}


###############################################################################
# ApprovalProcessViewSet
###############################################################################


class ApprovalProcessViewSet(ModelViewSet):
    """CRUD + nested ``steps`` action for :class:`ApprovalProcess`.

    Writes (create / update / destroy / steps POST) require the
    ``approvals.manage`` permission. Reads (list / retrieve / steps GET)
    require only tenant membership.
    """

    pagination_class = CRMCursorPagination
    serializer_class = ApprovalProcessSerializer
    filterset_class = ApprovalProcessFilter
    queryset = ApprovalProcess.objects.select_related("tenant").prefetch_related("steps")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "steps") and self.request.method == "GET":
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("approvals.manage")]

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        target_model = self.request.query_params.get("target_model")
        if target_model:
            qs = qs.filter(target_model=target_model)
        is_active = self.request.query_params.get("is_active")
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() in ("true", "1"))
        return qs

    def perform_create(self, serializer: ApprovalProcessSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ steps

    @action(detail=True, methods=["get", "post"], url_path="steps")
    def steps(self, request: Request, pk: str | None = None) -> Response:
        """GET lists the process's ordered steps; POST creates a new step."""
        process: ApprovalProcess = self.get_object()  # type: ignore[assignment]
        if request.method == "GET":
            qs = process.steps.all().order_by("order", "id")
            return Response(
                ApprovalStepSerializer(qs, many=True, context={"request": request}).data
            )
        data = dict(request.data)
        data["process"] = process.pk
        serializer = ApprovalStepSerializer(data=data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save(tenant=self.request.tenant, process=process)  # type: ignore[attr-defined]
        return Response(serializer.data, status=status.HTTP_201_CREATED)


###############################################################################
# ApprovalRequestViewSet
###############################################################################


class ApprovalRequestViewSet(ModelViewSet):
    """List / retrieve + runtime actions for :class:`ApprovalRequest`.

    Actions:

    * ``approve`` (POST ``{"comment": "..."}``) — approve the current step.
    * ``reject`` (POST ``{"comment": "..."}``) — reject the request.
    * ``delegate`` (POST ``{"delegate_to": <user_id>, "comment": "..."}``)
      — re-route the current step.
    * ``recall`` (POST) — submitter cancels the request.
    * ``bulk_approve`` (POST ``{"ids": [...], "comment": "..."}``) — approve
      many requests at once. Only requests where the current user is an
      approver in the current step are touched.
    * ``pending`` (GET) — requests awaiting the current user's action.
    * ``my_requests`` (GET) — requests submitted by the current user.
    * ``actions`` (GET) — append-only audit log for the request.
    """

    pagination_class = CRMCursorPagination
    serializer_class = ApprovalRequestSerializer
    filterset_class = ApprovalRequestFilter
    queryset = ApprovalRequest.objects.select_related(
        "process", "submitted_by", "current_step", "tenant"
    )

    def get_permissions(self) -> Any:
        # Reads + the runtime actions are open to any tenant member; the
        # service layer enforces submitter / approver constraints.
        return [IsAuthenticated(), IsTenantMember()]

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        submitted_by = self.request.query_params.get("submitted_by")
        if submitted_by:
            qs = qs.filter(submitted_by_id=submitted_by)
        target_module = self.request.query_params.get("target_module")
        if target_module:
            qs = qs.filter(target_module=target_module)
        target_id = self.request.query_params.get("target_id")
        if target_id:
            qs = qs.filter(target_id=target_id)
        return qs

    def perform_create(self, serializer: ApprovalRequestSerializer) -> None:  # type: ignore[override]
        """Create via the service so the first step + approvers are wired up.

        Accepts ``process_name`` + ``target_module`` + ``target_id`` +
        ``target_name`` + optional ``record_data``. The service resolves
        the active process by name and dispatches the first-step
        notifications.
        """
        request = self.request  # type: ignore[attr-defined]
        data = serializer.validated_data
        process = data.get("process")
        if process is None:
            raise DRFValidationError({"process": "process is required."})
        target_module = data.get("target_module") or ""
        target_id = data.get("target_id") or ""
        target_name = data.get("target_name") or ""
        record_data = request.data.get("record_data") or None
        try:
            approval_request = ApprovalService().submit(
                record_module=target_module,
                record_id=target_id,
                record_name=target_name,
                process_name=process.name,
                submitted_by=request.user,
                record_data=record_data,
            )
        except ValueError as exc:
            raise DRFValidationError({"detail": str(exc)}) from exc
        serializer.instance = approval_request

    # ------------------------------------------------------------------ actions

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{"comment": "..."}`` to approve the current step."""
        approval_request: ApprovalRequest = self.get_object()  # type: ignore[assignment]
        comment = request.data.get("comment") or ""
        try:
            ApprovalService().approve(
                request=approval_request, user=request.user, comment=comment
            )
        except ValueError as exc:
            raise DRFValidationError({"detail": str(exc)}) from exc
        return Response(
            ApprovalRequestSerializer(approval_request, context={"request": request}).data
        )

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{"comment": "..."}`` to reject the request."""
        approval_request: ApprovalRequest = self.get_object()  # type: ignore[assignment]
        comment = request.data.get("comment") or ""
        try:
            ApprovalService().reject(
                request=approval_request, user=request.user, comment=comment
            )
        except ValueError as exc:
            raise DRFValidationError({"detail": str(exc)}) from exc
        return Response(
            ApprovalRequestSerializer(approval_request, context={"request": request}).data
        )

    @action(detail=True, methods=["post"], url_path="delegate")
    def delegate(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{"delegate_to": <user_id>, "comment": "..."}``."""
        approval_request: ApprovalRequest = self.get_object()  # type: ignore[assignment]
        delegate_to_id = request.data.get("delegate_to")
        comment = request.data.get("comment") or ""
        if not delegate_to_id:
            return Response(
                {"detail": "delegate_to is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from api.models import User

        delegate_to = get_object_or_404(User, pk=delegate_to_id)
        try:
            ApprovalService().delegate(
                request=approval_request,
                user=request.user,
                delegate_to=delegate_to,
                comment=comment,
            )
        except ValueError as exc:
            raise DRFValidationError({"detail": str(exc)}) from exc
        return Response(
            ApprovalRequestSerializer(approval_request, context={"request": request}).data
        )

    @action(detail=True, methods=["post"], url_path="recall")
    def recall(self, request: Request, pk: str | None = None) -> Response:
        """POST to recall (cancel) a pending request. Submitter only."""
        approval_request: ApprovalRequest = self.get_object()  # type: ignore[assignment]
        try:
            ApprovalService().recall(request=approval_request, user=request.user)
        except ValueError as exc:
            raise DRFValidationError({"detail": str(exc)}) from exc
        return Response(
            ApprovalRequestSerializer(approval_request, context={"request": request}).data
        )

    @action(detail=False, methods=["post"], url_path="bulk-approve")
    def bulk_approve(self, request: Request) -> Response:
        """POST ``{"ids": [...], "comment": "..."}`` to approve many at once.

        Only requests where the current user is an approver in the current
        step are touched. Errors per request are collected into the
        response payload so the caller can retry the failed ones.
        """
        ids = request.data.get("ids") or []
        comment = request.data.get("comment") or ""
        if not isinstance(ids, list) or not ids:
            return Response(
                {"detail": "ids must be a non-empty list."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        service = ApprovalService()
        pending = {r.pk: r for r in service.get_pending_for_user(request.user)}
        results: list[dict[str, Any]] = []
        approved = 0
        for raw_id in ids:
            try:
                rid = int(raw_id)
            except (TypeError, ValueError):
                results.append({"id": raw_id, "ok": False, "error": "invalid_id"})
                continue
            approval_request = pending.get(rid)
            if approval_request is None:
                results.append({"id": rid, "ok": False, "error": "not_pending_for_user"})
                continue
            try:
                service.approve(request=approval_request, user=request.user, comment=comment)
                results.append({"id": rid, "ok": True})
                approved += 1
            except ValueError as exc:
                results.append({"id": rid, "ok": False, "error": str(exc)})
        return Response({"approved": approved, "results": results})

    @action(detail=False, methods=["get"], url_path="pending")
    def pending(self, request: Request) -> Response:
        """Requests awaiting the current user's action."""
        service = ApprovalService()
        qs = service.get_pending_for_user(request.user)
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = ApprovalRequestSerializer(page, many=True, context={"request": request})
            return self.get_paginated_response(serializer.data)
        serializer = ApprovalRequestSerializer(qs, many=True, context={"request": request})
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="my-requests")
    def my_requests(self, request: Request) -> Response:
        """Requests submitted by the current user."""
        service = ApprovalService()
        qs = service.get_my_requests(request.user)
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = ApprovalRequestSerializer(page, many=True, context={"request": request})
            return self.get_paginated_response(serializer.data)
        serializer = ApprovalRequestSerializer(qs, many=True, context={"request": request})
        return Response(serializer.data)

    @action(detail=True, methods=["get"], url_path="actions")
    def actions(self, request: Request, pk: str | None = None) -> Response:
        """Append-only audit log for the request."""
        approval_request: ApprovalRequest = self.get_object()  # type: ignore[assignment]
        qs = approval_request.actions.select_related("approver").order_by("-timestamp")
        return Response(
            ApprovalActionSerializer(qs, many=True, context={"request": request}).data
        )


###############################################################################
# ApprovalDelegationViewSet
###############################################################################


class ApprovalDelegationViewSet(ModelViewSet):
    """CRUD for :class:`ApprovalDelegation`.

    A user may have multiple delegations but only one *active* per date
    range — the viewset enforces a soft singleton by rejecting overlapping
    active ranges for the same user.
    """

    pagination_class = CRMCursorPagination
    serializer_class = ApprovalDelegationSerializer
    filterset_class = ApprovalDelegationFilter
    queryset = ApprovalDelegation.objects.select_related("user", "delegate_to", "tenant")

    def get_permissions(self) -> Any:
        return [IsAuthenticated(), IsTenantMember()]

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        user_param = self.request.query_params.get("user")
        if user_param:
            qs = qs.filter(user_id=user_param)
        is_active = self.request.query_params.get("is_active")
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() in ("true", "1"))
        return qs

    def perform_create(self, serializer: ApprovalDelegationSerializer) -> None:  # type: ignore[override]
        try:
            serializer.save(
                tenant=self.request.tenant,  # type: ignore[attr-defined]
                user=self.request.user,  # type: ignore[attr-defined]
            )
        except DjangoValidationError as exc:
            raise DRFValidationError(_format_validation_error(exc)) from exc

    def perform_update(self, serializer: ApprovalDelegationSerializer) -> None:  # type: ignore[override]
        try:
            serializer.save()
        except DjangoValidationError as exc:
            raise DRFValidationError(_format_validation_error(exc)) from exc


__all__ = [
    "ApprovalDelegationViewSet",
    "ApprovalProcessViewSet",
    "ApprovalRequestViewSet",
]

"""DRF ViewSets for the hr app.

* :class:`EmployeeViewSet` — CRUD.
* :class:`LeaveRequestViewSet` — CRUD + ``approve`` + ``reject``.
* :class:`ExpenseClaimViewSet` — CRUD + ``approve`` + ``reject``.
"""

from __future__ import annotations

from typing import Any

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .models import (
    Employee,
    ExpenseClaim,
    LeaveRequest,
    LR_APPROVED,
    LR_REJECTED,
)
from .serializers import (
    EmployeeSerializer,
    ExpenseClaimSerializer,
    LeaveRequestSerializer,
)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("hr.manage")]


class EmployeeViewSet(ModelViewSet):
    """CRUD on :class:`Employee`."""

    pagination_class = CRMCursorPagination
    serializer_class = EmployeeSerializer
    queryset = Employee.objects.select_related("tenant", "user")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: EmployeeSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


class LeaveRequestViewSet(ModelViewSet):
    """CRUD on :class:`LeaveRequest` + ``approve`` + ``reject``."""

    pagination_class = CRMCursorPagination
    serializer_class = LeaveRequestSerializer
    queryset = LeaveRequest.objects.select_related("tenant", "employee")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: LeaveRequestSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request: Request, pk: str | None = None) -> Response:
        """POST — flip status to ``approved``."""
        leave: LeaveRequest = self.get_object()  # type: ignore[assignment]
        leave.status = LR_APPROVED
        leave.save(update_fields=["status", "updated_at"])
        return Response(LeaveRequestSerializer(leave).data)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request: Request, pk: str | None = None) -> Response:
        """POST — flip status to ``rejected``."""
        leave: LeaveRequest = self.get_object()  # type: ignore[assignment]
        leave.status = LR_REJECTED
        leave.save(update_fields=["status", "updated_at"])
        return Response(LeaveRequestSerializer(leave).data)


class ExpenseClaimViewSet(ModelViewSet):
    """CRUD on :class:`ExpenseClaim` + ``approve`` + ``reject``."""

    pagination_class = CRMCursorPagination
    serializer_class = ExpenseClaimSerializer
    queryset = ExpenseClaim.objects.select_related("tenant", "employee")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: ExpenseClaimSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request: Request, pk: str | None = None) -> Response:
        """POST — flip status to ``approved``."""
        claim: ExpenseClaim = self.get_object()  # type: ignore[assignment]
        claim.status = LR_APPROVED
        claim.save(update_fields=["status", "updated_at"])
        return Response(ExpenseClaimSerializer(claim).data)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request: Request, pk: str | None = None) -> Response:
        """POST — flip status to ``rejected``."""
        claim: ExpenseClaim = self.get_object()  # type: ignore[assignment]
        claim.status = LR_REJECTED
        claim.save(update_fields=["status", "updated_at"])
        return Response(ExpenseClaimSerializer(claim).data)


__all__ = [
    "EmployeeViewSet",
    "ExpenseClaimViewSet",
    "LeaveRequestViewSet",
]

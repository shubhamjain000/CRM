"""DRF ViewSets for the invoicing app.

* :class:`InvoiceViewSet` — CRUD + ``send`` + ``mark_paid``.
* :class:`EstimateViewSet` — CRUD.
* :class:`PaymentViewSet` — CRUD.
"""

from __future__ import annotations

from typing import Any

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .models import Estimate, Invoice, INV_PAID, INV_SENT, Payment
from .serializers import (
    EstimateSerializer,
    InvoiceSerializer,
    PaymentSerializer,
)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("invoicing.manage")]


class InvoiceViewSet(ModelViewSet):
    """CRUD on :class:`Invoice` + ``send`` + ``mark_paid``."""

    pagination_class = CRMCursorPagination
    serializer_class = InvoiceSerializer
    queryset = Invoice.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: InvoiceSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="send")
    def send(self, request: Request, pk: str | None = None) -> Response:
        """POST — flip status to ``sent``."""
        invoice: Invoice = self.get_object()  # type: ignore[assignment]
        invoice.status = INV_SENT
        invoice.save(update_fields=["status", "updated_at"])
        return Response(InvoiceSerializer(invoice).data)

    @action(detail=True, methods=["post"], url_path="mark_paid")
    def mark_paid(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{amount?, method?, paid_at?, reference?}`` — flip to ``paid``
        + optionally create a :class:`Payment` row.
        """
        invoice: Invoice = self.get_object()  # type: ignore[assignment]
        invoice.status = INV_PAID
        invoice.save(update_fields=["status", "updated_at"])
        amount = request.data.get("amount")
        if amount is not None:
            Payment.objects.create(
                tenant=request.tenant,
                invoice=invoice,
                amount=amount,
                method=request.data.get("method", ""),
                paid_at=request.data.get("paid_at") or timezone.now(),
                reference=request.data.get("reference", ""),
            )
        return Response(InvoiceSerializer(invoice).data)


class EstimateViewSet(ModelViewSet):
    """CRUD on :class:`Estimate`."""

    pagination_class = CRMCursorPagination
    serializer_class = EstimateSerializer
    queryset = Estimate.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: EstimateSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


class PaymentViewSet(ModelViewSet):
    """CRUD on :class:`Payment`."""

    pagination_class = CRMCursorPagination
    serializer_class = PaymentSerializer
    queryset = Payment.objects.select_related("tenant", "invoice")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: PaymentSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


__all__ = ["EstimateViewSet", "InvoiceViewSet", "PaymentViewSet"]

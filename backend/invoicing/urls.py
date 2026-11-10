"""URL routes for the invoicing app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import EstimateViewSet, InvoiceViewSet, PaymentViewSet

router = DefaultRouter()
router.register(r"invoices", InvoiceViewSet, basename="invoice")
router.register(r"estimates", EstimateViewSet, basename="estimate")
router.register(r"payments", PaymentViewSet, basename="payment")

urlpatterns: list = list(router.urls)

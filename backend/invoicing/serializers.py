"""DRF serializers for the invoicing app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Estimate, Invoice, Payment


class InvoiceSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Invoice`."""

    class Meta:
        model = Invoice
        fields = [
            "id",
            "customer_name",
            "customer_email",
            "invoice_number",
            "issue_date",
            "due_date",
            "subtotal",
            "tax",
            "total",
            "status",
            "line_items",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class EstimateSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Estimate`."""

    class Meta:
        model = Estimate
        fields = [
            "id",
            "customer_name",
            "customer_email",
            "estimate_number",
            "issue_date",
            "due_date",
            "subtotal",
            "tax",
            "total",
            "status",
            "line_items",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class PaymentSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Payment`."""

    invoice_number = serializers.CharField(source="invoice.invoice_number", read_only=True)

    class Meta:
        model = Payment
        fields = [
            "id",
            "invoice",
            "invoice_number",
            "amount",
            "method",
            "paid_at",
            "reference",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


__all__ = ["EstimateSerializer", "InvoiceSerializer", "PaymentSerializer"]

"""Database models for the invoicing app (Phase 19).

Three tenant-scoped models: :class:`Invoice`, :class:`Estimate`, and
:class:`Payment`. Invoice + Estimate share an identical field shape
(customer / dates / subtotal / tax / total / line_items / notes) but
carry different ``status`` choice sets; they are kept as distinct tables
to avoid polymorphic queries.
"""

from __future__ import annotations

from django.db import models

from api.models import TenantModel

# Invoice status
INV_DRAFT = "draft"
INV_SENT = "sent"
INV_PAID = "paid"
INV_OVERDUE = "overdue"
INV_CANCELLED = "cancelled"
INVOICE_STATUS_CHOICES = [
    (INV_DRAFT, "draft"),
    (INV_SENT, "sent"),
    (INV_PAID, "paid"),
    (INV_OVERDUE, "overdue"),
    (INV_CANCELLED, "cancelled"),
]

# Estimate status
EST_DRAFT = "draft"
EST_SENT = "sent"
EST_ACCEPTED = "accepted"
EST_REJECTED = "rejected"
ESTIMATE_STATUS_CHOICES = [
    (EST_DRAFT, "draft"),
    (EST_SENT, "sent"),
    (EST_ACCEPTED, "accepted"),
    (EST_REJECTED, "rejected"),
]


class Invoice(TenantModel):
    """A tenant-scoped invoice."""

    customer_name = models.CharField(max_length=255, db_index=True)
    customer_email = models.EmailField(blank=True, default="")
    invoice_number = models.CharField(max_length=64, db_index=True)
    issue_date = models.DateField()
    due_date = models.DateField()
    subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    tax = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    status = models.CharField(
        max_length=16, choices=INVOICE_STATUS_CHOICES, default=INV_DRAFT, db_index=True
    )
    line_items = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True, default="")

    class Meta:
        db_table = "invoicing_invoice"
        verbose_name = "invoice"
        verbose_name_plural = "invoices"
        ordering = ["-issue_date", "-created_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="inv_status_idx"),
            models.Index(fields=["tenant", "issue_date"], name="inv_issue_idx"),
        ]

    def __str__(self) -> str:
        return f"Invoice {self.invoice_number} ({self.customer_name})"


class Estimate(TenantModel):
    """A tenant-scoped estimate / quote."""

    customer_name = models.CharField(max_length=255, db_index=True)
    customer_email = models.EmailField(blank=True, default="")
    estimate_number = models.CharField(max_length=64, db_index=True)
    issue_date = models.DateField()
    due_date = models.DateField()
    subtotal = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    tax = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    status = models.CharField(
        max_length=16, choices=ESTIMATE_STATUS_CHOICES, default=EST_DRAFT, db_index=True
    )
    line_items = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True, default="")

    class Meta:
        db_table = "invoicing_estimate"
        verbose_name = "estimate"
        verbose_name_plural = "estimates"
        ordering = ["-issue_date", "-created_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="est_status_idx"),
            models.Index(fields=["tenant", "issue_date"], name="est_issue_idx"),
        ]

    def __str__(self) -> str:
        return f"Estimate {self.estimate_number} ({self.customer_name})"


class Payment(TenantModel):
    """A payment applied to an :class:`Invoice`."""

    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        related_name="payments",
    )
    amount = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    method = models.CharField(max_length=32, blank=True, default="")
    paid_at = models.DateTimeField(null=True, blank=True)
    reference = models.CharField(max_length=128, blank=True, default="")

    class Meta:
        db_table = "invoicing_payment"
        verbose_name = "payment"
        verbose_name_plural = "payments"
        ordering = ["-paid_at", "-created_at"]
        indexes = [
            models.Index(fields=["tenant", "invoice"], name="pay_invoice_idx"),
        ]

    def __str__(self) -> str:
        return f"Payment {self.amount} for {self.invoice.invoice_number}"


__all__ = [
    "Invoice",
    "Estimate",
    "Payment",
    "INV_DRAFT",
    "INV_SENT",
    "INV_PAID",
    "INV_OVERDUE",
    "INV_CANCELLED",
    "INVOICE_STATUS_CHOICES",
    "EST_DRAFT",
    "EST_SENT",
    "EST_ACCEPTED",
    "EST_REJECTED",
    "ESTIMATE_STATUS_CHOICES",
]

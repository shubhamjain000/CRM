"""Model-layer tests for the invoicing app."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from invoicing.models import (
    Estimate,
    Invoice,
    INV_DRAFT,
    INV_PAID,
    Payment,
)


pytestmark = pytest.mark.django_db


def test_invoice_estimate_and_payment_round_trip(active_tenant):  # type: ignore[no-untyped-def]
    inv = Invoice.objects.create(
        tenant=active_tenant,
        customer_name="Globex",
        customer_email="ap@globex.com",
        invoice_number="INV-001",
        issue_date=date(2024, 1, 1),
        due_date=date(2024, 1, 15),
        subtotal=Decimal("100.00"),
        tax=Decimal("10.00"),
        total=Decimal("110.00"),
        line_items=[{"desc": "Widget", "qty": 1, "price": "100.00"}],
    )
    est = Estimate.objects.create(
        tenant=active_tenant,
        customer_name="Globex",
        estimate_number="EST-001",
        issue_date=date(2024, 1, 1),
        due_date=date(2024, 1, 31),
        subtotal=Decimal("50.00"),
        total=Decimal("50.00"),
    )
    pay = Payment.objects.create(
        tenant=active_tenant, invoice=inv, amount=Decimal("110.00"), method="card"
    )
    assert inv.status == INV_DRAFT
    assert est.status == "draft"
    assert str(inv) == "Invoice INV-001 (Globex)"
    assert str(est) == "Estimate EST-001 (Globex)"
    assert pay.invoice_id == inv.pk
    inv.status = INV_PAID
    inv.save(update_fields=["status", "updated_at"])
    assert inv.status == INV_PAID

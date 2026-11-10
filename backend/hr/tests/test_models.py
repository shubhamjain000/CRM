"""Model-layer tests for the hr app."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from hr.models import (
    Employee,
    EMP_ACTIVE,
    EMP_ON_LEAVE,
    ExpenseClaim,
    LeaveRequest,
    LR_APPROVED,
    LR_PENDING,
)


pytestmark = pytest.mark.django_db


def test_employee_leave_and_expense_round_trip(active_tenant, user):  # type: ignore[no-untyped-def]
    emp = Employee.objects.create(
        tenant=active_tenant,
        user=user,
        name="Alice Lee",
        email="alice@example.com",
        department="Engineering",
        designation="Manager",
        join_date=date(2022, 6, 1),
        status=EMP_ACTIVE,
    )
    leave = LeaveRequest.objects.create(
        tenant=active_tenant,
        employee=emp,
        type="annual",
        start_date=date(2024, 7, 1),
        end_date=date(2024, 7, 5),
        status=LR_PENDING,
        reason="Vacation",
    )
    claim = ExpenseClaim.objects.create(
        tenant=active_tenant,
        employee=emp,
        amount=Decimal("120.50"),
        category="travel",
        description="Taxi",
        status=LR_PENDING,
        receipt_url="https://example.com/r.pdf",
    )
    assert emp.status == EMP_ACTIVE
    assert leave.status == LR_PENDING
    assert claim.amount == Decimal("120.50")
    leave.status = LR_APPROVED
    leave.save(update_fields=["status", "updated_at"])
    emp.status = EMP_ON_LEAVE
    emp.save(update_fields=["status", "updated_at"])
    assert leave.status == LR_APPROVED
    assert emp.status == EMP_ON_LEAVE
    assert str(emp) == "Employee: Alice Lee (alice@example.com)"
    assert "annual" in str(leave)
    assert "travel" in str(claim)

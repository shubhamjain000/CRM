"""Database models for the hr app (Phase 19).

Three tenant-scoped models: :class:`Employee`, :class:`LeaveRequest`,
:class:`ExpenseClaim`.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from api.models import TenantModel

# Employee status
EMP_ACTIVE = "active"
EMP_ON_LEAVE = "on_leave"
EMP_TERMINATED = "terminated"
EMPLOYEE_STATUS_CHOICES = [
    (EMP_ACTIVE, "active"),
    (EMP_ON_LEAVE, "on_leave"),
    (EMP_TERMINATED, "terminated"),
]

# Leave / expense status
LR_PENDING = "pending"
LR_APPROVED = "approved"
LR_REJECTED = "rejected"
LR_PAID = "paid"  # only used by ExpenseClaim
LEAVE_STATUS_CHOICES = [
    (LR_PENDING, "pending"),
    (LR_APPROVED, "approved"),
    (LR_REJECTED, "rejected"),
]
EXPENSE_STATUS_CHOICES = [
    (LR_PENDING, "pending"),
    (LR_APPROVED, "approved"),
    (LR_REJECTED, "rejected"),
    (LR_PAID, "paid"),
]


class Employee(TenantModel):
    """A tenant employee."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employee_profiles",
    )
    name = models.CharField(max_length=255, db_index=True)
    email = models.EmailField(db_index=True)
    department = models.CharField(max_length=128, blank=True, default="")
    designation = models.CharField(max_length=128, blank=True, default="")
    join_date = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=16, choices=EMPLOYEE_STATUS_CHOICES, default=EMP_ACTIVE, db_index=True
    )

    class Meta:
        db_table = "hr_employee"
        verbose_name = "employee"
        verbose_name_plural = "employees"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="emp_status_idx"),
            models.Index(fields=["tenant", "department"], name="emp_dept_idx"),
        ]

    def __str__(self) -> str:
        return f"Employee: {self.name} ({self.email})"


class LeaveRequest(TenantModel):
    """A tenant employee's leave request."""

    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name="leave_requests",
    )
    type = models.CharField(max_length=32, blank=True, default="annual")
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(
        max_length=16, choices=LEAVE_STATUS_CHOICES, default=LR_PENDING, db_index=True
    )
    reason = models.TextField(blank=True, default="")

    class Meta:
        db_table = "hr_leaverequest"
        verbose_name = "leave request"
        verbose_name_plural = "leave requests"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "employee"], name="lr_emp_idx"),
            models.Index(fields=["tenant", "status"], name="lr_status_idx"),
        ]

    def __str__(self) -> str:
        return f"Leave {self.type} {self.start_date}→{self.end_date} ({self.status})"


class ExpenseClaim(TenantModel):
    """A tenant employee's expense claim."""

    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name="expense_claims",
    )
    amount = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    category = models.CharField(max_length=64, blank=True, default="")
    description = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=16, choices=EXPENSE_STATUS_CHOICES, default=LR_PENDING, db_index=True
    )
    receipt_url = models.URLField(blank=True, default="")

    class Meta:
        db_table = "hr_expenseclaim"
        verbose_name = "expense claim"
        verbose_name_plural = "expense claims"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "employee"], name="ec_emp_idx"),
            models.Index(fields=["tenant", "status"], name="ec_status_idx"),
        ]

    def __str__(self) -> str:
        return f"Expense {self.amount} ({self.category}, {self.status})"


__all__ = [
    "Employee",
    "LeaveRequest",
    "ExpenseClaim",
    "EMP_ACTIVE",
    "EMP_ON_LEAVE",
    "EMP_TERMINATED",
    "EMPLOYEE_STATUS_CHOICES",
    "LR_PENDING",
    "LR_APPROVED",
    "LR_REJECTED",
    "LR_PAID",
    "LEAVE_STATUS_CHOICES",
    "EXPENSE_STATUS_CHOICES",
]

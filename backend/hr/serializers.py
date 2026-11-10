"""DRF serializers for the hr app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Employee, ExpenseClaim, LeaveRequest


class EmployeeSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Employee`."""

    user_email = serializers.CharField(source="user.email", read_only=True, default="")

    class Meta:
        model = Employee
        fields = [
            "id",
            "user",
            "user_email",
            "name",
            "email",
            "department",
            "designation",
            "join_date",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class LeaveRequestSerializer(serializers.ModelSerializer):
    """Serializer for :class:`LeaveRequest`."""

    employee_name = serializers.CharField(source="employee.name", read_only=True, default="")

    class Meta:
        model = LeaveRequest
        fields = [
            "id",
            "employee",
            "employee_name",
            "type",
            "start_date",
            "end_date",
            "status",
            "reason",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class ExpenseClaimSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ExpenseClaim`."""

    employee_name = serializers.CharField(source="employee.name", read_only=True, default="")

    class Meta:
        model = ExpenseClaim
        fields = [
            "id",
            "employee",
            "employee_name",
            "amount",
            "category",
            "description",
            "status",
            "receipt_url",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


__all__ = [
    "EmployeeSerializer",
    "ExpenseClaimSerializer",
    "LeaveRequestSerializer",
]

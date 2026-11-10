"""URL routes for the hr app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import (
    EmployeeViewSet,
    ExpenseClaimViewSet,
    LeaveRequestViewSet,
)

router = DefaultRouter()
router.register(r"employees", EmployeeViewSet, basename="employee")
router.register(r"leave-requests", LeaveRequestViewSet, basename="leaverequest")
router.register(r"expense-claims", ExpenseClaimViewSet, basename="expenseclaim")

urlpatterns: list = list(router.urls)

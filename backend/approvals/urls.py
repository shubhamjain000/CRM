"""URL routes for the approvals app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from approvals.viewsets import (
    ApprovalDelegationViewSet,
    ApprovalProcessViewSet,
    ApprovalRequestViewSet,
)

router = DefaultRouter()
router.register(r"approval-processes", ApprovalProcessViewSet, basename="approvalprocess")
router.register(r"approval-requests", ApprovalRequestViewSet, basename="approvalrequest")
router.register(r"approval-delegations", ApprovalDelegationViewSet, basename="approvaldelegation")

urlpatterns = router.urls

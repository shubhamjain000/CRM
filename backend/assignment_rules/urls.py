"""URL routes for the assignment_rules app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from assignment_rules.viewsets import (
    AssignmentHistoryViewSet,
    AssignmentRuleViewSet,
)

router = DefaultRouter()
router.register(r"assignment-rules", AssignmentRuleViewSet, basename="assignmentrule")
router.register(
    r"assignment-histories", AssignmentHistoryViewSet, basename="assignmenthistory"
)

urlpatterns = router.urls

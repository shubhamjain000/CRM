"""URL routes for the escalation_rules app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from escalation_rules.viewsets import (
    EscalationLogViewSet,
    EscalationRuleViewSet,
)

router = DefaultRouter()
router.register(r"escalation-rules", EscalationRuleViewSet, basename="escalationrule")
router.register(r"escalation-logs", EscalationLogViewSet, basename="escalationlog")

urlpatterns = router.urls

"""URL routes for the workflows app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from workflows.viewsets import WorkflowExecutionViewSet, WorkflowRuleViewSet

router = DefaultRouter()
router.register(r"workflow-rules", WorkflowRuleViewSet, basename="workflowrule")
router.register(r"workflow-executions", WorkflowExecutionViewSet, basename="workflowexecution")

urlpatterns = router.urls

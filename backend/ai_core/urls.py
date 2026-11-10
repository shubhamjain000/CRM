"""URL routes for the ai_core app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import AICostLogViewSet, PromptTemplateViewSet

router = DefaultRouter()
router.register(r"ai-cost-logs", AICostLogViewSet, basename="aicostlog")
router.register(r"prompt-templates", PromptTemplateViewSet, basename="prompttemplate")

urlpatterns: list = list(router.urls)

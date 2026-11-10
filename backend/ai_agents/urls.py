"""URL routes for the ai_agents app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import AIAgentRunViewSet

router = DefaultRouter()
router.register(r"ai-agent-runs", AIAgentRunViewSet, basename="aiagentrun")

urlpatterns: list = list(router.urls)

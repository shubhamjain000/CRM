"""URL routes for the goals app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import GoalAchievementViewSet, GoalViewSet

router = DefaultRouter()
router.register(r"goals", GoalViewSet, basename="goal")
router.register(r"goal-achievements", GoalAchievementViewSet, basename="goalachievement")

urlpatterns: list = list(router.urls)

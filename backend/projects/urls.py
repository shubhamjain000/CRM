"""URL routes for the projects app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import ProjectTaskViewSet, ProjectViewSet, TimeEntryViewSet

router = DefaultRouter()
router.register(r"projects", ProjectViewSet, basename="project")
router.register(r"project-tasks", ProjectTaskViewSet, basename="projecttask")
router.register(r"time-entries", TimeEntryViewSet, basename="timeentry")

urlpatterns: list = list(router.urls)

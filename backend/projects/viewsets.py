"""DRF ViewSets for the projects app.

* :class:`ProjectViewSet` — CRUD.
* :class:`ProjectTaskViewSet` — CRUD.
* :class:`TimeEntryViewSet` — CRUD.
"""

from __future__ import annotations

from typing import Any

from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .models import Project, ProjectTask, TimeEntry
from .serializers import (
    ProjectSerializer,
    ProjectTaskSerializer,
    TimeEntrySerializer,
)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("projects.manage")]


class ProjectViewSet(ModelViewSet):
    """CRUD on :class:`Project`."""

    pagination_class = CRMCursorPagination
    serializer_class = ProjectSerializer
    queryset = Project.objects.select_related("tenant", "manager")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: ProjectSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


class ProjectTaskViewSet(ModelViewSet):
    """CRUD on :class:`ProjectTask`."""

    pagination_class = CRMCursorPagination
    serializer_class = ProjectTaskSerializer
    queryset = ProjectTask.objects.select_related("tenant", "project", "assignee")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: ProjectTaskSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


class TimeEntryViewSet(ModelViewSet):
    """CRUD on :class:`TimeEntry`."""

    pagination_class = CRMCursorPagination
    serializer_class = TimeEntrySerializer
    queryset = TimeEntry.objects.select_related("tenant", "project", "task", "user")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: TimeEntrySerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


__all__ = ["ProjectTaskViewSet", "ProjectViewSet", "TimeEntryViewSet"]

"""URL routes for the audit app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import AuditLogViewSet

router = DefaultRouter()
router.register(r"audit-logs", AuditLogViewSet, basename="audit-log")

urlpatterns: list = list(router.urls)

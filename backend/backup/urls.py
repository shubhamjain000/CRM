"""URL routes for the backup app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import BackupRecordViewSet

router = DefaultRouter()
router.register(r"backups", BackupRecordViewSet, basename="backup")

urlpatterns: list = list(router.urls)

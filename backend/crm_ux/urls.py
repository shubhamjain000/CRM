"""URL routes for the CRM UX app.

All routes mount under ``/api/v1/`` (see ``config/urls.py``).
"""

from __future__ import annotations

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .viewsets import (
    ActivityViewSet,
    FileAttachmentViewSet,
    NoteViewSet,
    RecentlyViewedViewSet,
    RecordLockViewSet,
    SavedViewSet,
    TrashViewSet,
    timeline_view,
)

router = DefaultRouter()
router.register(r"saved-views", SavedViewSet, basename="saved-view")
router.register(r"recently-viewed", RecentlyViewedViewSet, basename="recently-viewed")
router.register(r"activities", ActivityViewSet, basename="activity")
router.register(r"notes", NoteViewSet, basename="note")
router.register(r"file-attachments", FileAttachmentViewSet, basename="file-attachment")
router.register(r"record-locks", RecordLockViewSet, basename="record-lock")
router.register(r"trash", TrashViewSet, basename="trash")

urlpatterns = [
    path("", include(router.urls)),
    # Convenience: merged activity + note timeline for a single record.
    path(
        "timeline/<str:module>/<str:record_id>/",
        timeline_view,
        name="record-timeline",
    ),
]

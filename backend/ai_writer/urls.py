"""URL routes for the ai_writer app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import AIWriterDraftViewSet

router = DefaultRouter()
router.register(r"ai-writer-drafts", AIWriterDraftViewSet, basename="aiwriterdraft")

urlpatterns: list = list(router.urls)

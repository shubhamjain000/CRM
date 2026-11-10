"""URL routes for the attachments app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from attachments.views import AttachmentViewSet

router = DefaultRouter()
router.register(r"attachments", AttachmentViewSet, basename="attachment")

urlpatterns = router.urls

"""URL routes for the leads app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from leads.views import LeadViewSet

router = DefaultRouter()
router.register(r"leads", LeadViewSet, basename="lead")

urlpatterns = router.urls

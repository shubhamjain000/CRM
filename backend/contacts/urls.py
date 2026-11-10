"""URL routes for the contacts app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from contacts.views import ContactViewSet

router = DefaultRouter()
router.register(r"contacts", ContactViewSet, basename="contact")

urlpatterns = router.urls

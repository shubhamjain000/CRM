"""URL routes for the accounts app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from accounts.views import AccountViewSet

router = DefaultRouter()
router.register(r"accounts", AccountViewSet, basename="account")

urlpatterns = router.urls

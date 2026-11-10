"""URL routes for the territories app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import TerritoryMemberViewSet, TerritoryViewSet

router = DefaultRouter()
router.register(r"territories", TerritoryViewSet, basename="territory")
router.register(r"territory-members", TerritoryMemberViewSet, basename="territorymember")

urlpatterns: list = list(router.urls)

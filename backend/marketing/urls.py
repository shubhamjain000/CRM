"""URL routes for the marketing app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import (
    CampaignViewSet,
    MarketingEmailViewSet,
    SubscriberListViewSet,
)

router = DefaultRouter()
router.register(r"campaigns", CampaignViewSet, basename="campaign")
router.register(r"subscriber-lists", SubscriberListViewSet, basename="subscriberlist")
router.register(r"marketing-emails", MarketingEmailViewSet, basename="marketingemail")

urlpatterns: list = list(router.urls)

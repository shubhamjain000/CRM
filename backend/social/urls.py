"""URL routes for the social app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from social.viewsets import (
    ScheduledPostViewSet,
    SocialAccountViewSet,
    SocialMentionViewSet,
)

router = DefaultRouter()
router.register(r"social-accounts", SocialAccountViewSet, basename="socialaccount")
router.register(r"social-mentions", SocialMentionViewSet, basename="socialmention")
router.register(r"scheduled-posts", ScheduledPostViewSet, basename="scheduledpost")

urlpatterns: list = list(router.urls)

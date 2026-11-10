"""URL routes for the feed app.

All routes mount under ``/api/v1/`` (see ``config/urls.py``).
"""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import FeedCommentViewSet, FeedPostViewSet, FeedReactionViewSet

router = DefaultRouter()
router.register(r"feed/posts", FeedPostViewSet, basename="feed-post")
router.register(r"feed/comments", FeedCommentViewSet, basename="feed-comment")
router.register(r"feed/reactions", FeedReactionViewSet, basename="feed-reaction")

urlpatterns = router.urls

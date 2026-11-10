"""URL routes for the unified inbox app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from inbox.viewsets import (
    InboxMacroViewSet,
    UnifiedConversationViewSet,
    UnifiedMessageViewSet,
)

router = DefaultRouter()
router.register(
    r"inbox-conversations", UnifiedConversationViewSet, basename="unifiedconversation"
)
router.register(r"inbox-messages", UnifiedMessageViewSet, basename="unifiedmessage")
router.register(r"inbox-macros", InboxMacroViewSet, basename="inboxmacro")

urlpatterns: list = list(router.urls)

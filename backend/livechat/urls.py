"""URL routes for the livechat app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from livechat.viewsets import (
    CannedResponseViewSet,
    ChatMessageViewSet,
    ChatSessionViewSet,
    ProactiveRuleViewSet,
)

router = DefaultRouter()
router.register(r"chat-sessions", ChatSessionViewSet, basename="chatsession")
router.register(r"chat-messages", ChatMessageViewSet, basename="chatmessage")
router.register(r"canned-responses", CannedResponseViewSet, basename="cannedresponse")
router.register(r"proactive-rules", ProactiveRuleViewSet, basename="proactiverule")

urlpatterns: list = list(router.urls)

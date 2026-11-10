"""URL routes for the zia_chatbot app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import ZiaConversationViewSet

router = DefaultRouter()
router.register(
    r"zia-conversations", ZiaConversationViewSet, basename="ziaconversation"
)

urlpatterns: list = list(router.urls)

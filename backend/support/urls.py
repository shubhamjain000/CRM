"""URL routes for the support app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import (
    KnowledgeBaseArticleViewSet,
    TicketReplyViewSet,
    TicketViewSet,
)

router = DefaultRouter()
router.register(r"tickets", TicketViewSet, basename="ticket")
router.register(r"ticket-replies", TicketReplyViewSet, basename="ticketreply")
router.register(
    r"kb-articles", KnowledgeBaseArticleViewSet, basename="kbarticle"
)

urlpatterns: list = list(router.urls)

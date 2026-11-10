"""URL routes for the whatsapp app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from whatsapp.viewsets import (
    WhatsAppAccountViewSet,
    WhatsAppMessageViewSet,
    WhatsAppTemplateViewSet,
)

router = DefaultRouter()
router.register(r"whatsapp-accounts", WhatsAppAccountViewSet, basename="whatsappaccount")
router.register(r"whatsapp-messages", WhatsAppMessageViewSet, basename="whatsappmessage")
router.register(r"whatsapp-templates", WhatsAppTemplateViewSet, basename="whatsapptemplate")

urlpatterns: list = list(router.urls)

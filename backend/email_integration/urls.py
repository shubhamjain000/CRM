"""URL routes for the email_integration app.

DRF router for the five viewsets. Tracking pixel / click-redirect endpoints
are intentionally omitted here — they live under a public (AllowAny) path
mounted separately in :mod:`config.urls` (or behind a CDN) in production.
"""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from email_integration.viewsets import (
    EmailAccountViewSet,
    EmailSignatureViewSet,
    EmailThreadViewSet,
    EmailViewSet,
    MailMergeCampaignViewSet,
)

router = DefaultRouter()
router.register(r"email-accounts", EmailAccountViewSet, basename="emailaccount")
router.register(r"emails", EmailViewSet, basename="email")
router.register(r"email-threads", EmailThreadViewSet, basename="emailthread")
router.register(r"email-signatures", EmailSignatureViewSet, basename="emailsignature")
router.register(
    r"mail-merge-campaigns", MailMergeCampaignViewSet, basename="mailmergecampaign"
)

urlpatterns: list = list(router.urls)

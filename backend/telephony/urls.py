"""URL routes for the telephony app.

DRF router for the five viewsets. Inbound webhooks from the provider
(Twilio / Exotel / Vonage / Plivo / MSG91) are mounted separately under
a public (AllowAny) path in :mod:`config.urls` — they live outside the
authenticated CRM API surface.
"""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from telephony.viewsets import (
    IvrFlowViewSet,
    PhoneNumberViewSet,
    SmsMessageViewSet,
    SmsTemplateViewSet,
    TelephonyCallViewSet,
)

router = DefaultRouter()
router.register(r"phone-numbers", PhoneNumberViewSet, basename="phonenumber")
router.register(r"calls", TelephonyCallViewSet, basename="telephonycall")
router.register(r"sms-templates", SmsTemplateViewSet, basename="smstemplate")
router.register(r"sms-messages", SmsMessageViewSet, basename="smsmessage")
router.register(r"ivr-flows", IvrFlowViewSet, basename="ivrflow")

urlpatterns: list = list(router.urls)

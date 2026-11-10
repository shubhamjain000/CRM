"""Model-layer tests for the security_monitoring app."""

from __future__ import annotations

import pytest

from security_monitoring.models import (
    ALERT_ACKNOWLEDGED,
    SEV_HIGH,
    SecurityAlert,
    SecurityEvent,
)


pytestmark = pytest.mark.django_db


def test_security_models_round_trip(active_tenant):  # type: ignore[no-untyped-def]
    event = SecurityEvent.objects.create(
        tenant=active_tenant,
        event_type="brute_force_login",
        severity=SEV_HIGH,
        description="5 failed logins",
        ip="203.0.113.5",
        metadata={"attempts": 5},
    )
    alert = SecurityAlert.objects.create(
        tenant=active_tenant,
        event=event,
        status=ALERT_ACKNOWLEDGED,
    )
    assert "brute_force_login" in str(event)
    assert alert.event_id == event.pk
    assert alert.status == ALERT_ACKNOWLEDGED

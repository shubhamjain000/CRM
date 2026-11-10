"""Model-layer tests for the access_control app."""

from __future__ import annotations

import pytest

from access_control.models import IPAllowlist, SessionPolicy, TrustedDevice


pytestmark = pytest.mark.django_db


def test_access_control_models_round_trip(active_tenant, user):  # type: ignore[no-untyped-def]
    from django.db import transaction

    ip = IPAllowlist.objects.create(
        tenant=active_tenant, cidr="10.0.0.0/8", is_active=True
    )
    policy = SessionPolicy.objects.create(
        tenant=active_tenant, timeout_minutes=30, max_concurrent=5
    )
    device = TrustedDevice.objects.create(
        tenant=active_tenant, user=user, device_id="dev-abc"
    )
    assert "10.0.0.0/8" in str(ip)
    assert str(policy).startswith("session-policy(")
    assert "dev-abc" in str(device)

    # SessionPolicy is unique per tenant.
    with pytest.raises(Exception):  # noqa: PT011
        with transaction.atomic():
            SessionPolicy.objects.create(
                tenant=active_tenant, timeout_minutes=10, max_concurrent=1
            )

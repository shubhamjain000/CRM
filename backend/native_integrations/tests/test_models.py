"""Model-layer tests for the native_integrations app."""

from __future__ import annotations

import pytest

from native_integrations.models import (
    Integration,
    IntegrationLog,
    LOG_OK,
    PROVIDER_SLACK,
    PROVIDER_STRIPE,
)


pytestmark = pytest.mark.django_db


def test_integration_and_log_round_trip(active_tenant):  # type: ignore[no-untyped-def]
    integ = Integration.objects.create(
        tenant=active_tenant,
        provider=PROVIDER_SLACK,
        is_connected=True,
        config={"bot_token": "xoxb-..."},
    )
    log = IntegrationLog.objects.create(
        tenant=active_tenant,
        integration=integ,
        event="connect",
        status=LOG_OK,
        details={"scopes": ["chat:write"]},
    )
    # Unique per (tenant, provider).
    with pytest.raises(Exception):  # noqa: PT011
        Integration.objects.create(
            tenant=active_tenant, provider=PROVIDER_SLACK, is_connected=False
        )

    # Different provider is fine.
    stripe = Integration.objects.create(
        tenant=active_tenant, provider=PROVIDER_STRIPE, is_connected=False
    )
    assert stripe.provider == PROVIDER_STRIPE
    assert log.integration_id == integ.pk
    assert str(integ) == f"slack @ {active_tenant.slug} (connected)"
    assert "connect" in str(log)

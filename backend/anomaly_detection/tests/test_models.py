"""Model-layer tests for the anomaly_detection app."""

from __future__ import annotations

import pytest

from anomaly_detection.models import (
    ANOMALY_DEAL_AMOUNT_DROP,
    Anomaly,
    SEVERITY_HIGH,
    STATUS_OPEN,
)


pytestmark = pytest.mark.django_db


def test_anomaly_defaults_and_str(active_tenant):  # type: ignore[no-untyped-def]
    anomaly = Anomaly.objects.create(
        tenant=active_tenant,
        record_type="deal",
        record_id="42",
        anomaly_type=ANOMALY_DEAL_AMOUNT_DROP,
        severity=SEVERITY_HIGH,
        description="Deal 42 dropped 35%.",
    )
    assert anomaly.status == STATUS_OPEN
    assert "deal:42" in str(anomaly)


def test_anomaly_unique_open_per_target_is_enforced_in_service(active_tenant):  # type: ignore[no-untyped-def]
    # The uniqueness is enforced in _create_anomaly (no DB constraint), so
    # multiple rows are allowed at the DB level — the service de-dupes.
    Anomaly.objects.create(
        tenant=active_tenant, record_type="deal", record_id="42",
        anomaly_type=ANOMALY_DEAL_AMOUNT_DROP,
    )
    Anomaly.objects.create(
        tenant=active_tenant, record_type="deal", record_id="42",
        anomaly_type=ANOMALY_DEAL_AMOUNT_DROP,
    )
    assert Anomaly.objects.filter(tenant=active_tenant).count() == 2

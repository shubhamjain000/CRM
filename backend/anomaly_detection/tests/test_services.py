"""Service-layer tests for the anomaly_detection app."""

from __future__ import annotations

from anomaly_detection.models import Anomaly, SEVERITY_HIGH, STATUS_ACKNOWLEDGED, STATUS_RESOLVED
from anomaly_detection.services import (
    acknowledge_anomaly,
    get_trends,
    resolve_anomaly,
    scan_anomalies,
)


pytestmark = pytest.mark.django_db


def test_acknowledge_and_resolve_state_transitions(active_tenant, user):  # type: ignore[no-untyped-def]
    anomaly = Anomaly.objects.create(
        tenant=active_tenant, record_type="deal", record_id="9",
        severity=SEVERITY_HIGH,
    )
    acknowledge_anomaly(anomaly, user=user)
    assert anomaly.status == STATUS_ACKNOWLEDGED
    assert anomaly.acknowledged_by_id == user.pk

    resolve_anomaly(anomaly)
    assert anomaly.status == STATUS_RESOLVED


def test_scan_anomalies_with_no_data_returns_zero(active_tenant):  # type: ignore[no-untyped-def]
    result = scan_anomalies(tenant=active_tenant)
    assert result == {"created": 0}
    # trends endpoint returns empty when there are no rows
    assert get_trends(tenant=active_tenant) == []

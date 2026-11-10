"""Model-layer tests for the compliance app."""

from __future__ import annotations

import pytest

from compliance.models import (
    STATUS_MET,
    ComplianceChecklist,
    ComplianceFramework,
    DataProcessingConsent,
)


pytestmark = pytest.mark.django_db


def test_compliance_models_round_trip(active_tenant, user):  # type: ignore[no-untyped-def]
    fw = ComplianceFramework.objects.create(
        name="SOC 2", description="Service Org Controls", is_active=True
    )
    checklist = ComplianceChecklist.objects.create(
        tenant=active_tenant,
        framework=fw,
        item="Enable audit logging",
        status=STATUS_MET,
        evidence="audit.log enabled",
    )
    consent = DataProcessingConsent.objects.create(
        tenant=active_tenant,
        user=user,
        consent_type="marketing_email",
    )
    assert str(fw) == "SOC 2"
    assert "SOC 2" in str(checklist)
    assert "marketing_email" in str(consent)

"""Model-layer tests for the data_security app."""

from __future__ import annotations

import pytest

from data_security.models import (
    ACTION_ARCHIVE,
    CLASS_CONFIDENTIAL,
    DataClassification,
    RetentionPolicy,
)


pytestmark = pytest.mark.django_db


def test_data_security_models_round_trip(active_tenant):  # type: ignore[no-untyped-def]
    cls = DataClassification.objects.create(
        tenant=active_tenant,
        model="leads.Lead",
        field="ssn",
        classification=CLASS_CONFIDENTIAL,
    )
    policy = RetentionPolicy.objects.create(
        tenant=active_tenant,
        model="leads.Lead",
        retention_days=90,
        action=ACTION_ARCHIVE,
    )
    assert "confidential" in str(cls)
    assert "archive" in str(policy)

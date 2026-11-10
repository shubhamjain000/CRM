"""Model-layer tests for the audit app."""

from __future__ import annotations

import pytest

from audit.models import AuditLog


pytestmark = pytest.mark.django_db


def test_audit_log_is_immutable(active_tenant):  # type: ignore[no-untyped-def]
    log = AuditLog.objects.create(
        tenant=active_tenant,
        actor_id="u-1",
        action="create",
        target_type="lead",
        target_id="42",
        changes={"name": [None, "Acme"]},
        ip="127.0.0.1",
        user_agent="curl/8.0",
    )
    assert log.pk is not None
    assert "create" in str(log)

    # Update blocked.
    log.action = "update"
    with pytest.raises(PermissionError):
        log.save()

    # Delete blocked.
    with pytest.raises(PermissionError):
        log.delete()

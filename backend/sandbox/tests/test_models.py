"""Model-layer tests for the sandbox app."""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

import pytest

from sandbox.factories import SandboxFactory
from sandbox.models import Sandbox


pytestmark = pytest.mark.django_db


def test_sandbox_unique_branch_per_tenant(active_tenant):  # type: ignore[no-untyped-def]
    SandboxFactory(tenant=active_tenant, branch_name="dev")
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        SandboxFactory(tenant=active_tenant, branch_name="dev")


def test_sandbox_is_expired_property(active_tenant):  # type: ignore[no-untyped-def]
    past = SandboxFactory(
        tenant=active_tenant, branch_name="past",
        expires_at=timezone.now() - timedelta(hours=1),
    )
    future = SandboxFactory(
        tenant=active_tenant, branch_name="future",
        expires_at=timezone.now() + timedelta(hours=1),
    )
    assert past.is_expired is True
    assert future.is_expired is False

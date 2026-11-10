"""Service-layer tests for the sandbox app."""

from __future__ import annotations

from sandbox.factories import SandboxFactory
from sandbox.services import compare_sandboxes, create_snapshot, push_to_production


pytestmark = pytest.mark.django_db


def test_create_snapshot_returns_expected_sections(active_tenant):  # type: ignore[no-untyped-def]
    snapshot = create_snapshot(active_tenant)
    assert "custom_modules" in snapshot
    assert "layouts" in snapshot
    assert "profiles" in snapshot
    assert "territories" in snapshot
    assert "canvas" in snapshot
    assert "template_builder" in snapshot
    assert "captured_at" in snapshot


def test_compare_sandboxes_reports_count_deltas(active_tenant):  # type: ignore[no-untyped-def]
    src = SandboxFactory(
        tenant=active_tenant, branch_name="src",
        snapshot_data={"custom_modules": [{"id": 1}, {"id": 2}]},
    )
    tgt = SandboxFactory(
        tenant=active_tenant, branch_name="tgt",
        snapshot_data={"custom_modules": [{"id": 1}]},
    )
    diff = compare_sandboxes(src, tgt)
    assert "sections" in diff
    cm = diff["sections"]["custom_modules"]
    assert cm["source_count"] == 2
    assert cm["target_count"] == 1
    assert cm["delta"] == -1


def test_push_to_production_flips_is_active(active_tenant):  # type: ignore[no-untyped-def]
    sandbox = SandboxFactory(tenant=active_tenant, branch_name="b1", is_active=True)
    result = push_to_production(sandbox)
    assert result["status"] == "merged"
    sandbox.refresh_from_db()
    assert sandbox.is_active is False

"""Service-layer tests for the custom_functions app.

Covers :class:`custom_functions.services.CustomFunctionService`:
* ``execute`` — happy path + approval-gate enforcement + counters.
* ``save_version`` / ``restore_version`` — snapshotting + rollback.
* ``get_metrics`` — aggregate metrics for an execution history.
* ``get_templates`` — pre-built function templates.
"""

from __future__ import annotations

import pytest

from custom_functions.factories import (
    CustomFunctionExecutionFactory,
    CustomFunctionFactory,
)
from custom_functions.models import CustomFunctionVersion
from custom_functions.services import CustomFunctionService


pytestmark = pytest.mark.django_db


###############################################################################
# execute
###############################################################################


def test_execute_manual_run_completes_and_updates_counters(active_tenant, user):  # type: ignore[no-untyped-def]
    fn = CustomFunctionFactory(
        tenant=active_tenant,
        code="return {'doubled': input_data['x'] * 2}",
        is_approved=False,  # manual trigger bypasses the gate
    )
    execution = CustomFunctionService().execute(
        function_id=fn.pk, input_data={"x": 21}, trigger="manual", user=user
    )
    assert execution.status == "completed"
    assert execution.output_data == {"doubled": 42}
    assert execution.execution_time_ms >= 0
    fn.refresh_from_db()
    assert fn.execution_count == 1
    assert fn.error_count == 0
    assert fn.last_executed_at is not None


def test_execute_unapproved_webhook_trigger_blocked(active_tenant, user):  # type: ignore[no-untyped-def]
    fn = CustomFunctionFactory(
        tenant=active_tenant,
        trigger_event="webhook",
        code="return input_data",
        is_approved=False,
    )
    with pytest.raises(PermissionError):
        CustomFunctionService().execute(
            function_id=fn.pk, input_data={}, trigger="webhook", user=user
        )


def test_execute_failed_run_records_error_and_increments_error_count(active_tenant, user):  # type: ignore[no-untyped-def]
    fn = CustomFunctionFactory(
        tenant=active_tenant,
        code="raise ValueError('boom')",
        is_approved=False,
    )
    execution = CustomFunctionService().execute(
        function_id=fn.pk, input_data={}, trigger="manual", user=user
    )
    assert execution.status == "failed"
    assert "ValueError" in execution.error_message
    fn.refresh_from_db()
    assert fn.execution_count == 1
    assert fn.error_count == 1


###############################################################################
# save_version / restore_version
###############################################################################


def test_save_version_snapshots_current_code(active_tenant, user):  # type: ignore[no-untyped-def]
    fn = CustomFunctionFactory(tenant=active_tenant, code="return 1", version=1)
    CustomFunctionService().save_version(fn, user)
    fn.refresh_from_db()
    assert fn.version == 2
    version = CustomFunctionVersion.objects.get(function=fn, version=1)
    assert version.code == "return 1"


def test_restore_version_rolls_back_code(active_tenant, user):  # type: ignore[no-untyped-def]
    fn = CustomFunctionFactory(tenant=active_tenant, code="return 1", version=1)
    CustomFunctionService().save_version(fn, user)  # v1 -> v2
    fn.code = "return 2"
    fn.save()
    CustomFunctionService().restore_version(fn, version=1, user=user)
    fn.refresh_from_db()
    assert fn.code == "return 1"
    # The rollback itself was versioned (current code was snapshotted before restore).
    assert CustomFunctionVersion.objects.filter(function=fn).count() >= 2


###############################################################################
# get_metrics
###############################################################################


def test_get_metrics_with_executions(active_tenant, user):  # type: ignore[no-untyped-def]
    fn = CustomFunctionFactory(tenant=active_tenant)
    CustomFunctionExecutionFactory.create_batch(
        2, tenant=active_tenant, function=fn, status="completed", execution_time_ms=10
    )
    CustomFunctionExecutionFactory(
        tenant=active_tenant, function=fn, status="failed", execution_time_ms=5
    )
    metrics = CustomFunctionService().get_metrics(fn.pk)
    assert metrics["total_executions"] == 3
    assert metrics["success_rate"] == round(2 / 3, 4)
    assert metrics["avg_execution_time"] == pytest.approx(25 / 3, rel=1e-3)
    assert metrics["last_run"] is not None


def test_get_metrics_empty_function(active_tenant, user):  # type: ignore[no-untyped-def]
    fn = CustomFunctionFactory(tenant=active_tenant)
    metrics = CustomFunctionService().get_metrics(fn.pk)
    assert metrics["total_executions"] == 0
    assert metrics["success_rate"] == 0.0
    assert metrics["last_run"] is None


###############################################################################
# get_templates
###############################################################################


def test_get_templates_returns_five_prebuilt(active_tenant, user):  # type: ignore[no-untyped-def]
    templates = CustomFunctionService().get_templates()
    names = {t["name"] for t in templates}
    assert len(templates) == 5
    assert "Lead Score Calculator" in names
    assert "Sync Deal to External System" in names
    assert "Generate Invoice PDF" in names
    assert "Send WhatsApp on Stage Change" in names
    assert "Auto-merge Duplicate Contacts" in names
    for template in templates:
        assert template["code"]
        assert template["language"] == "python"
        assert isinstance(template["variables"], list)

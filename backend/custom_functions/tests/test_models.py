"""Model-layer tests for the custom_functions app."""

from __future__ import annotations

import pytest

from custom_functions.factories import (
    CustomFunctionExecutionFactory,
    CustomFunctionFactory,
    CustomFunctionVariableFactory,
    CustomFunctionVersionFactory,
    HttpAllowlistFactory,
    HttpCallLogFactory,
    KVStoreFactory,
)
from custom_functions.models import (
    CustomFunction,
    CustomFunctionVariable,
    CustomFunctionVersion,
    HttpAllowlist,
    HttpCallLog,
    KVStore,
)


pytestmark = pytest.mark.django_db


def test_custom_function_str_and_defaults(active_tenant, user):  # type: ignore[no-untyped-def]
    fn = CustomFunctionFactory(tenant=active_tenant, name="Score Lead")
    assert "Score Lead" in str(fn)
    assert fn.language == "python"
    assert fn.trigger_event == "manual"
    assert fn.is_active is True
    assert fn.is_approved is False
    assert fn.execution_count == 0
    assert fn.error_count == 0
    assert fn.version == 1


def test_custom_function_variable_unique_per_function(active_tenant, user):  # type: ignore[no-untyped-def]
    fn = CustomFunctionFactory(tenant=active_tenant)
    CustomFunctionVariableFactory(tenant=active_tenant, function=fn, name="lead_id")
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError raised by unique_together
        CustomFunctionVariableFactory(tenant=active_tenant, function=fn, name="lead_id")
    assert CustomFunctionVariable.objects.filter(function=fn).count() == 1


def test_custom_function_execution_str(active_tenant, user):  # type: ignore[no-untyped-def]
    fn = CustomFunctionFactory(tenant=active_tenant, name="Score")
    execution = CustomFunctionExecutionFactory(
        tenant=active_tenant, function=fn, status="completed"
    )
    text = str(execution)
    assert "Score" in text
    assert "completed" in text


def test_custom_function_version_unique_per_function(active_tenant, user):  # type: ignore[no-untyped-def]
    fn = CustomFunctionFactory(tenant=active_tenant)
    CustomFunctionVersionFactory(tenant=active_tenant, function=fn, version=1)
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        CustomFunctionVersionFactory(tenant=active_tenant, function=fn, version=1)
    assert CustomFunctionVersion.objects.filter(function=fn).count() == 1


def test_kv_store_unique_per_tenant_and_allowlist(active_tenant, user):  # type: ignore[no-untyped-def]
    KVStoreFactory(tenant=active_tenant, key="counter", value="1")
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        KVStoreFactory(tenant=active_tenant, key="counter", value="2")
    HttpAllowlistFactory(tenant=active_tenant, domain="api.example.com")
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        HttpAllowlistFactory(tenant=active_tenant, domain="api.example.com")
    HttpCallLogFactory(tenant=active_tenant)
    assert KVStore.objects.filter(tenant=active_tenant).count() == 1
    assert HttpAllowlist.objects.filter(tenant=active_tenant).count() == 1
    assert HttpCallLog.objects.filter(tenant=active_tenant).count() == 1


def test_custom_function_query_filters_by_trigger(active_tenant, user):  # type: ignore[no-untyped-def]
    CustomFunctionFactory.create_batch(2, tenant=active_tenant, trigger_event="manual")
    CustomFunctionFactory(tenant=active_tenant, trigger_event="webhook")
    assert (
        CustomFunction.objects.filter(trigger_event="manual").count() == 2
    )
    assert (
        CustomFunction.objects.filter(trigger_event="webhook").count() == 1
    )

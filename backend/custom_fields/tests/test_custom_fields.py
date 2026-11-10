"""Tests for the custom_fields app — models, registry, services, signal, view."""

from __future__ import annotations

import pytest
from unittest import mock

from accounts.factories import AccountFactory
from custom_fields.factories import CustomFieldFactory, CustomFieldValueFactory
from custom_fields.models import CustomField, CustomFieldValue
from custom_fields.registry import REGISTRY, validate_value
from custom_fields.services import (
    apply_defaults,
    get_custom_fields,
    get_values,
    set_value,
)

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------- model tests


def test_custom_field_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    field = CustomFieldFactory()
    assert field.pk is not None
    assert field.tenant_id == active_tenant.pk
    assert field.api_name.startswith("field_")


def test_custom_field_unique_api_name_per_module(active_tenant):  # type: ignore[no-untyped-def]
    from django.db import IntegrityError

    CustomFieldFactory(api_name="duplicate", module="lead")
    with pytest.raises(IntegrityError):
        CustomFieldFactory(api_name="duplicate", module="lead", tenant=active_tenant)


def test_custom_field_clean_picklist_requires_choices(active_tenant):  # type: ignore[no-untyped-def]
    from django.core.exceptions import ValidationError

    field = CustomFieldFactory.build(field_type="picklist", field_options={})
    field.tenant = active_tenant
    with pytest.raises(ValidationError):
        field.clean()


def test_custom_field_clean_lookup_requires_target(active_tenant):  # type: ignore[no-untyped-def]
    from django.core.exceptions import ValidationError

    field = CustomFieldFactory.build(field_type="lookup", field_options={})
    field.tenant = active_tenant
    with pytest.raises(ValidationError):
        field.clean()


def test_custom_field_clean_picklist_ok(active_tenant):  # type: ignore[no-untyped-def]
    field = CustomFieldFactory.build(
        field_type="picklist",
        field_options={"choices": ["A", "B"]},
    )
    field.tenant = active_tenant
    field.clean()  # no exception


# ---------------------------------------------------------------- registry tests


def test_registry_has_25_types():  # type: ignore[no-untyped-def]
    assert len(REGISTRY) == 25


def test_validate_value_text():  # type: ignore[no-untyped-def]
    assert validate_value("text", "hello") == "hello"
    assert validate_value("text", None) == ""


def test_validate_value_email():  # type: ignore[no-untyped-def]
    assert validate_value("email", "a@b.com") == "a@b.com"
    with pytest.raises(ValueError):
        validate_value("email", "nope")


def test_validate_value_number():  # type: ignore[no-untyped-def]
    assert validate_value("number", "42") == 42.0
    with pytest.raises(ValueError):
        validate_value("number", "nope")


def test_validate_value_percent_range():  # type: ignore[no-untyped-def]
    assert validate_value("percent", 50) == 50.0
    with pytest.raises(ValueError):
        validate_value("percent", 150)


def test_validate_value_picklist_with_choices():  # type: ignore[no-untyped-def]
    opts = {"choices": ["A", "B"]}
    assert validate_value("picklist", "A", options=opts) == "A"
    with pytest.raises(ValueError):
        validate_value("picklist", "Z", options=opts)


def test_validate_value_multi_picklist():  # type: ignore[no-untyped-def]
    opts = {"choices": ["A", "B", "C"]}
    assert validate_value("multi_picklist", ["A", "B"], options=opts) == ["A", "B"]
    with pytest.raises(ValueError):
        validate_value("multi_picklist", ["A", "Z"], options=opts)


def test_validate_value_checkbox():  # type: ignore[no-untyped-def]
    assert validate_value("checkbox", True) is True
    assert validate_value("checkbox", "false") is False
    with pytest.raises(ValueError):
        validate_value("checkbox", "maybe")


def test_validate_value_rating_range():  # type: ignore[no-untyped-def]
    assert validate_value("rating", 4) == 4
    with pytest.raises(ValueError):
        validate_value("rating", 6)


def test_validate_value_unknown_type():  # type: ignore[no-untyped-def]
    with pytest.raises(KeyError):
        validate_value("bogus", "x")


# ---------------------------------------------------------------- service tests


def test_get_custom_fields_filters_by_tenant_and_module(active_tenant):  # type: ignore[no-untyped-def]
    CustomFieldFactory.create_batch(2, module="lead")
    CustomFieldFactory.create_batch(1, module="account")
    fields = get_custom_fields(tenant_id=active_tenant.pk, module="lead")
    assert len(fields) == 2


def test_get_values_batch_read(active_tenant):  # type: ignore[no-untyped-def]
    field = CustomFieldFactory(api_name="industry_segment", module="account")
    a1 = AccountFactory()
    a2 = AccountFactory()
    a3 = AccountFactory()
    CustomFieldValueFactory(field=field, module="account", record_id=str(a1.pk), value="enterprise")
    CustomFieldValueFactory(field=field, module="account", record_id=str(a2.pk), value="smb")
    out = get_values(
        tenant_id=active_tenant.pk,
        module="account",
        record_ids=[str(a1.pk), str(a2.pk), str(a3.pk)],
    )
    assert out[str(a1.pk)]["industry_segment"] == "enterprise"
    assert out[str(a2.pk)]["industry_segment"] == "smb"
    assert out[str(a3.pk)] == {}  # no values


def test_set_value_validates_and_upserts(active_tenant):  # type: ignore[no-untyped-def]
    field = CustomFieldFactory(api_name="rating_num", module="account", field_type="number")
    a = AccountFactory()
    set_value(tenant_id=active_tenant.pk, module="account", record_id=str(a.pk), field=field, value="42")
    row = CustomFieldValue.objects.get(field=field, record_id=str(a.pk))
    assert row.value == 42.0
    # Upsert — second call updates.
    set_value(tenant_id=active_tenant.pk, module="account", record_id=str(a.pk), field=field, value="100")
    row.refresh_from_db()
    assert row.value == 100.0
    # Only one row.
    assert CustomFieldValue.objects.filter(field=field, record_id=str(a.pk)).count() == 1


def test_set_value_rejects_invalid(active_tenant):  # type: ignore[no-untyped-def]
    field = CustomFieldFactory(api_name="email_cf", module="account", field_type="email")
    a = AccountFactory()
    with pytest.raises(ValueError):
        set_value(tenant_id=active_tenant.pk, module="account", record_id=str(a.pk), field=field, value="nope")


def test_apply_defaults_backfills(active_tenant):  # type: ignore[no-untyped-def]
    CustomFieldFactory(
        api_name="default_segment",
        module="account",
        field_type="text",
        default_value="enterprise",
    )
    a = AccountFactory()
    n = apply_defaults(tenant_id=active_tenant.pk, module="account", record_id=str(a.pk))
    assert n == 1
    # Idempotent — second call doesn't re-write.
    n2 = apply_defaults(tenant_id=active_tenant.pk, module="account", record_id=str(a.pk))
    assert n2 == 0


# ---------------------------------------------------------------- signal tests


def test_post_save_signal_enqueues_backfill(active_tenant):  # type: ignore[no-untyped-def]
    with mock.patch("custom_fields.tasks.backfill_defaults_for_field.delay") as mock_delay:
        # Creating with a default → enqueue.
        CustomFieldFactory(module="account", field_type="text", default_value="x")
        assert mock_delay.call_count == 1
        kwargs = mock_delay.call_args.kwargs
        assert kwargs["module"] == "account"
        assert kwargs["tenant_id"] == active_tenant.pk


def test_post_save_signal_skips_when_no_default(active_tenant):  # type: ignore[no-untyped-def]
    with mock.patch("custom_fields.tasks.backfill_defaults_for_field.delay") as mock_delay:
        CustomFieldFactory(module="account", field_type="text", default_value="")
        assert mock_delay.call_count == 0


def test_post_save_signal_skips_on_update(active_tenant):  # type: ignore[no-untyped-def]
    field = CustomFieldFactory(module="account", field_type="text", default_value="x")
    with mock.patch("custom_fields.tasks.backfill_defaults_for_field.delay") as mock_delay:
        field.label = "Updated"
        field.save()
        assert mock_delay.call_count == 0


# ---------------------------------------------------------------- view tests


def test_schema_endpoint(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    CustomFieldFactory.create_batch(2, module="lead")
    response = request_factory("GET", "/api/v1/custom-fields/schema/?module=lead")
    assert response.status_code == 200, response.content
    assert len(response.json()) == 2


def test_schema_endpoint_requires_module(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    response = request_factory("GET", "/api/v1/custom-fields/schema/")
    assert response.status_code == 400


def test_create_custom_field(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    payload = {
        "module": "lead",
        "label": "Lifecycle Stage",
        "api_name": "lifecycle_stage",
        "field_type": "picklist",
        "field_options": {"choices": ["A", "B"]},
    }
    response = request_factory("POST", "/api/v1/custom-fields/", payload, format="json")
    assert response.status_code == 201, response.content
    assert CustomField.objects.filter(api_name="lifecycle_stage").count() == 1


def test_create_custom_field_rejects_bad_api_name(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    payload = {
        "module": "lead",
        "label": "Bad",
        "api_name": "1Invalid Name",
        "field_type": "text",
    }
    response = request_factory("POST", "/api/v1/custom-fields/", payload, format="json")
    assert response.status_code == 400


def test_batch_read_values(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    field = CustomFieldFactory(api_name="tier", module="account", field_type="text")
    a = AccountFactory()
    set_value(tenant_id=active_tenant.pk, module="account", record_id=str(a.pk), field=field, value="gold")
    response = request_factory(
        "GET",
        f"/api/v1/custom-field-values/batch/?module=account&record_ids={a.pk}",
    )
    assert response.status_code == 200
    assert response.json()[str(a.pk)]["tier"] == "gold"


def test_filtering_by_custom_field_value(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    field = CustomFieldFactory(api_name="tier", module="account", field_type="text")
    a1 = AccountFactory(name="GoldAcct")
    a2 = AccountFactory(name="SilverAcct")
    set_value(tenant_id=active_tenant.pk, module="account", record_id=str(a1.pk), field=field, value="gold")
    set_value(tenant_id=active_tenant.pk, module="account", record_id=str(a2.pk), field=field, value="silver")
    response = request_factory("GET", "/api/v1/accounts/?custom_field=tier:gold")
    assert response.status_code == 200
    names = [r["name"] for r in response.json()["results"]]
    assert names == ["GoldAcct"]

"""Service-layer tests for the custom_modules app."""

from __future__ import annotations

import pytest
from django.core.exceptions import ValidationError

from custom_modules.factories import (
    CustomModuleFactory,
    CustomModuleFieldFactory,
)
from custom_modules.models import (
    FIELD_EMAIL,
    FIELD_NUMBER,
    FIELD_PICKLIST,
    FIELD_TEXT,
    CustomModuleField,
)
from custom_modules.services import (
    apply_defaults,
    clone_module,
    validate_record_data,
)


pytestmark = pytest.mark.django_db


def test_clone_module_copies_schema_not_records(active_tenant):  # type: ignore[no-untyped-def]
    module = CustomModuleFactory(tenant=active_tenant, slug="p")
    CustomModuleFieldFactory(
        tenant=active_tenant, module=module, api_name="name", field_type=FIELD_TEXT,
    )
    clone = clone_module(module)
    assert clone.pk != module.pk
    assert clone.slug != module.slug
    assert clone.fields.count() == 1
    # Source module unchanged.
    assert module.fields.count() == 1


def test_validate_record_data_enforces_required_and_types(active_tenant):  # type: ignore[no-untyped-def]
    module = CustomModuleFactory(tenant=active_tenant)
    CustomModuleFieldFactory(
        tenant=active_tenant, module=module, api_name="email",
        field_type=FIELD_EMAIL, is_required=True,
    )
    CustomModuleFieldFactory(
        tenant=active_tenant, module=module, api_name="age",
        field_type=FIELD_NUMBER,
    )
    CustomModuleFieldFactory(
        tenant=active_tenant, module=module, api_name="color",
        field_type=FIELD_PICKLIST, field_options={"choices": ["red", "blue"]},
    )

    # missing required email
    with pytest.raises(ValidationError):
        validate_record_data(module, {"age": 30})

    # bad email format
    with pytest.raises(ValidationError):
        validate_record_data(module, {"email": "no-at-sign"})

    # invalid picklist choice
    with pytest.raises(ValidationError):
        validate_record_data(module, {"email": "ok@x.com", "color": "green"})

    # happy path — defaults applied + valid data
    data = validate_record_data(module, {"email": "ok@x.com", "color": "red"})
    assert data["email"] == "ok@x.com"
    assert data["color"] == "red"


def test_apply_defaults_fills_missing_keys(active_tenant):  # type: ignore[no-untyped-def]
    module = CustomModuleFactory(tenant=active_tenant)
    CustomModuleFieldFactory(
        tenant=active_tenant, module=module, api_name="status",
        field_type=FIELD_TEXT, default_value="new",
    )
    out = apply_defaults(module, {"name": "x"})
    assert out["status"] == "new"
    assert out["name"] == "x"

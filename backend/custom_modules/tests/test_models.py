"""Model-layer tests for the custom_modules app."""

from __future__ import annotations

import pytest

from custom_modules.factories import (
    CustomModuleFactory,
    CustomModuleFieldFactory,
    CustomModuleRecordFactory,
)
from custom_modules.models import (
    FIELD_NUMBER,
    FIELD_TEXT,
    CustomModule,
    CustomModuleField,
    CustomModuleRecord,
)


pytestmark = pytest.mark.django_db


def test_module_str_includes_slug(active_tenant):  # type: ignore[no-untyped-def]
    module = CustomModuleFactory(tenant=active_tenant, name="Properties", slug="properties")
    assert str(module) == "Properties (properties)"


def test_field_unique_per_module(active_tenant):  # type: ignore[no-untyped-def]
    module = CustomModuleFactory(tenant=active_tenant)
    CustomModuleFieldFactory(
        tenant=active_tenant, module=module, api_name="price", field_type=FIELD_NUMBER,
    )
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        CustomModuleFieldFactory(
            tenant=active_tenant, module=module, api_name="price", field_type=FIELD_TEXT,
        )


def test_record_uses_record_name_field_for_display(active_tenant):  # type: ignore[no-untyped-def]
    module = CustomModuleFactory(
        tenant=active_tenant, record_name_field="title", slug="v"
    )
    record = CustomModuleRecordFactory(
        tenant=active_tenant, module=module, data={"title": "Veyron"}
    )
    assert "Veyron" in str(record)

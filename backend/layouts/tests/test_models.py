"""Model-layer tests for the layouts app."""

from __future__ import annotations

import pytest

from layouts.factories import LayoutFactory, LayoutSectionFactory
from layouts.models import Layout, LayoutSection, MODULE_LEAD


pytestmark = pytest.mark.django_db


def test_layout_str_includes_profile_when_present(active_tenant, user):  # type: ignore[no-untyped-def]
    layout = LayoutFactory(
        tenant=active_tenant, module=MODULE_LEAD, name="Default", profile=None
    )
    assert str(layout) == "lead/Default"


def test_section_belongs_to_layout(active_tenant):  # type: ignore[no-untyped-def]
    layout = LayoutFactory(tenant=active_tenant)
    section = LayoutSectionFactory(
        tenant=active_tenant, layout=layout, name="General", fields=["name", "email"]
    )
    assert list(layout.sections.all()) == [section]
    assert section.fields == ["name", "email"]


def test_layout_cascade_deletes_sections(active_tenant):  # type: ignore[no-untyped-def]
    layout = LayoutFactory(tenant=active_tenant)
    LayoutSectionFactory(tenant=active_tenant, layout=layout)
    layout_pk = layout.pk
    layout.delete()
    assert Layout.objects.filter(pk=layout_pk).count() == 0
    assert LayoutSection.objects.filter(layout_id=layout_pk).count() == 0

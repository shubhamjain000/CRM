"""Service-layer tests for the layouts app."""

from __future__ import annotations

from layouts.factories import LayoutFactory, LayoutSectionFactory
from layouts.models import Layout, LayoutSection
from layouts.services import clone_layout, get_fields_for_layout


pytestmark = pytest.mark.django_db


def test_get_fields_for_layout_flattens_sections(active_tenant):  # type: ignore[no-untyped-def]
    layout = LayoutFactory(tenant=active_tenant)
    LayoutSectionFactory(
        tenant=active_tenant, layout=layout, name="A", order=0, fields=["name", "email"]
    )
    LayoutSectionFactory(
        tenant=active_tenant, layout=layout, name="B", order=1, fields=["phone"]
    )
    out = get_fields_for_layout(layout)
    assert [f["api_name"] for f in out] == ["name", "email", "phone"]
    assert [f["section"] for f in out] == ["A", "A", "B"]


def test_clone_layout_copies_sections(active_tenant):  # type: ignore[no-untyped-def]
    layout = LayoutFactory(tenant=active_tenant, name="Original", is_default=True)
    LayoutSectionFactory(tenant=active_tenant, layout=layout, fields=["a", "b"])
    clone = clone_layout(layout)
    assert clone.pk != layout.pk
    assert clone.is_default is False
    assert clone.sections.count() == 1
    assert clone.sections.first().fields == ["a", "b"]

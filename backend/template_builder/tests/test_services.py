"""Service-layer tests for the template_builder app."""

from __future__ import annotations

from template_builder.factories import PdfTemplateFactory
from template_builder.models import PDF_INVOICE
from template_builder.services import preview_data, render_html


pytestmark = pytest.mark.django_db


def test_render_html_substitutes_variables():  # type: ignore[no-untyped-def]
    html = render_html("Hello {{ name }}!", {"name": "World"})
    assert html == "Hello World!"


def test_preview_data_returns_sample_for_category(active_tenant):  # type: ignore[no-untyped-def]
    pdf = PdfTemplateFactory(
        tenant=active_tenant, name="I", category=PDF_INVOICE,
        html_template="Invoice {{ number }} for {{ customer.name }}",
    )
    data = preview_data(pdf.category)
    rendered = render_html(pdf.html_template, data)
    assert "Invoice" in rendered
    assert "Globex" in rendered  # sample customer name

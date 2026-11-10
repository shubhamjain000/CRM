"""Model-layer tests for the template_builder app."""

from __future__ import annotations

import pytest

from template_builder.factories import EmailTemplateFactory, PdfTemplateFactory
from template_builder.models import (
    PDF_QUOTE,
    EmailTemplate,
    PdfTemplate,
)


pytestmark = pytest.mark.django_db


def test_email_template_unique_per_tenant(active_tenant):  # type: ignore[no-untyped-def]
    EmailTemplateFactory(tenant=active_tenant, name="Welcome")
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        EmailTemplateFactory(tenant=active_tenant, name="Welcome")


def test_pdf_template_defaults_to_quote_category(active_tenant):  # type: ignore[no-untyped-def]
    pdf = PdfTemplateFactory(tenant=active_tenant, name="Default Quote")
    assert pdf.category == PDF_QUOTE
    assert "Quote" in str(pdf)

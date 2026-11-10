"""factory_boy factories for the template_builder app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant

from .models import (
    PDF_INVOICE,
    PDF_QUOTE,
    EmailTemplate,
    PdfTemplate,
)


class EmailTemplateFactory(DjangoModelFactory):
    """Factory for :class:`EmailTemplate`."""

    class Meta:
        model = EmailTemplate

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Welcome Email {n}")
    subject = "Welcome to Foundation!"
    body_html = "<h1>Hello {{ first_name }}</h1><p>Thanks for signing up.</p>"
    category = "onboarding"


class PdfTemplateFactory(DjangoModelFactory):
    """Factory for :class:`PdfTemplate`."""

    class Meta:
        model = PdfTemplate

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Quote Template {n}")
    html_template = (
        "<html><body><h1>Quote {{ number }}</h1>"
        "<p>Customer: {{ customer.name }}</p>"
        "<p>Total: {{ total }}</p>"
        "</body></html>"
    )
    css = "body { font-family: sans-serif; }"
    category = PDF_QUOTE


__all__ = ["EmailTemplateFactory", "PdfTemplateFactory"]

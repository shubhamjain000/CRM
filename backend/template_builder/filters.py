"""django-filter FilterSets for the template_builder app."""

from __future__ import annotations

import django_filters

from .models import EmailTemplate, PdfTemplate


class EmailTemplateFilter(django_filters.FilterSet):
    """Filter email templates by name / category."""

    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")
    category = django_filters.CharFilter(field_name="category")

    class Meta:
        model = EmailTemplate
        fields: list[str] = []


class PdfTemplateFilter(django_filters.FilterSet):
    """Filter PDF templates by name / category."""

    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")
    category = django_filters.CharFilter(field_name="category")

    class Meta:
        model = PdfTemplate
        fields: list[str] = []

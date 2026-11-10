"""factory_boy factories for the canvas app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant

from .models import CanvasTheme, DENSITY_COMFORTABLE, SIDEBAR_LIGHT


class CanvasThemeFactory(DjangoModelFactory):
    """Factory for :class:`CanvasTheme`."""

    class Meta:
        model = CanvasTheme

    tenant = factory.LazyFunction(_current_tenant)
    primary_color = "#0ea5e9"
    accent_color = "#6366f1"
    font_family = "Inter"
    border_radius = 8
    density = DENSITY_COMFORTABLE
    sidebar_style = SIDEBAR_LIGHT
    logo_url = ""
    custom_css = ""


__all__ = ["CanvasThemeFactory"]

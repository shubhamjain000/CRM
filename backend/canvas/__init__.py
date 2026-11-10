"""Canvas app — tenant white-label theme.

Phase 17 — Salesforce-Canvas-equivalent: a single :class:`CanvasTheme`
row per tenant defines the org's visual identity (colors, fonts,
density, sidebar style, logo, custom CSS). Endpoints are a singleton
getter / patcher plus a ``templates`` listing (pre-built themes) and
a ``preview`` action that returns computed CSS for a candidate
override without persisting it.
"""

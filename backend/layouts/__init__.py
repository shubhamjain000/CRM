"""Layouts app — record page layouts.

Phase 17 — Salesforce-Layout-equivalent: defines how a record page is
structured (sections + columns + field placement) per module + profile.

* :class:`Layout` — keyed by (module, profile?). ``module`` is the
  string slug of a core module ("lead"/"deal"/"contact"/"account") or
  a custom module's slug. ``profile`` is nullable (null = default
  layout for the module). ``config`` is a JSONField for advanced
  customisation (tab ordering, related-list placement, etc.).
* :class:`LayoutSection` — a section inside a layout. ``fields`` is a
  JSON list of field ``api_name``s in display order.
"""

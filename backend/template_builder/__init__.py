"""Template builder app — email + PDF templates.

Phase 17 — Salesforce-Template-equivalent: tenant-scoped HTML
templates for outbound emails and PDF document generation. Both
expose ``preview`` (returns the template rendered with sample data)
and ``render`` (POST with a data payload → returns rendered HTML).

* :class:`EmailTemplate` — name / subject / body_html / category.
* :class:`PdfTemplate` — name / html_template / css / category
  (one of ``quote`` / ``invoice`` / ``contract`` / ``proposal``).
"""

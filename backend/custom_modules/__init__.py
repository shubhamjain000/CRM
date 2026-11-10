"""Custom modules app — user-defined CRM modules.

Phase 17 — Salesforce-Custom-Object-equivalent: lets tenants build new
record types ("Properties", "Vehicles", "Projects") on top of the core
CRM. Three tenant-scoped models:

* :class:`CustomModule` — module definition (name / plural / slug / icon
  / color / record_name_field / is_active / is_system).
* :class:`CustomModuleField` — field schema (label / api_name / field_type
  / field_options / default_value / is_required / is_unique /
  is_searchable / display_order / section).
* :class:`CustomModuleRecord` — generic record storage as a JSONField
  keyed by the field ``api_name``.
"""

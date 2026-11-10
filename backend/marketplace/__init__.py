"""marketplace app — extension catalog + per-tenant installs (Phase 19).

The marketplace exposes a global catalog of installable :class:`Extension`
rows (tenant FK nullable so an extension row is shared across tenants).
Each tenant records its own :class:`InstalledExtension` rows — config,
status (active / disabled / error), and sync timestamps — keyed by
(extension, tenant).
"""

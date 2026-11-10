"""Profiles app — role-based permission profiles.

Phase 17 — Salesforce-Profile-equivalent: a profile bundles module
permissions (can_view / can_create / can_edit / can_delete / can_export /
can_share) and field-level access (hidden / visible / read_only /
editable) for a tenant. Layouts can target a specific profile.

* :class:`Profile` — name + description + is_standard.
* :class:`ProfilePermission` — per-module CRUD + export + share flags.
* :class:`FieldPermission` — per-field access level.
"""

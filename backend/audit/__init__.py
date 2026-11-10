"""audit app — immutable audit log (Phase 20).

Single tenant-scoped model:

* :class:`AuditLog` — append-only audit trail with a field-level change
  diff. Indexed on ``(tenant, timestamp)`` and ``(tenant, target_type,
  target_id)`` so per-record history lookups are O(log n). The model
  overrides :meth:`save` + :meth:`delete` to make rows immutable once
  written.
"""

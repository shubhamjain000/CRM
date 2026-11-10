"""CRM UX backend app — saved views, recently-viewed, activities, notes,
file attachments, record locks, and trash management.

This app provides the UX-layer data that powers the Linear-grade CRM UI on top
of the four core CRM modules (leads / contacts / accounts / deals) built in
Phase 3. All models are tenant-scoped via :class:`api.models.TenantModel`.
"""

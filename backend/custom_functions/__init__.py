"""Custom functions scripting engine app (Phase 12).

Tenants can write small Python or JavaScript snippets — a.k.a. *custom
functions* — that run inside a sandboxed execution environment with a
limited CRM/HTTP/KV API surface. Functions are versioned, gated by an
admin-approval step before they execute in production, and every run is
recorded as a :class:`custom_functions.models.CustomFunctionExecution`
row for audit / debugging.
"""

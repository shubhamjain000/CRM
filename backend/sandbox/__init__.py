"""Sandbox app — configuration sandboxes per tenant.

Phase 17 — Salesforce-Sandbox-equivalent: lets tenants create a
configuration snapshot, branch off, experiment with customisations
(fields / layouts / workflows / territories), compare against
production, and push to production when ready.

A single :class:`Sandbox` row captures a branch name + snapshot_data
JSON + expiry + active flag.
"""

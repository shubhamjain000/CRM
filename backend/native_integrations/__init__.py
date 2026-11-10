"""native_integrations app — third-party provider connections (Phase 19).

Two tenant-scoped models:

* :class:`Integration` — a tenant's connection to an external provider
  (google_workspace / microsoft_365 / slack / zoom / mailchimp /
  quickbooks / stripe / razorpay / docusign / clearbit / hunter /
  calendly / zapier) with ``is_connected`` flag, ``config`` JSON, and
  ``last_synced_at``.
* :class:`IntegrationLog` — append-only per-integration event log
  (event / status / details / created_at).
"""

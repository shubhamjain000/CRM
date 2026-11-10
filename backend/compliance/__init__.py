"""compliance app — frameworks + checklists + consent registry
(Phase 20).

Three models (one global, two tenant-scoped):

* :class:`ComplianceFramework` — global catalog of compliance frameworks
  (SOC 2, ISO 27001, GDPR, HIPAA, PCI-DSS, ...).
* :class:`ComplianceChecklist` — per-tenant checklist item linked to a
  framework with status (pending / met / not_applicable) and free-text
  evidence.
* :class:`DataProcessingConsent` — per-tenant per-user consent record
  with ``granted_at`` + ``withdrawn_at`` timestamps.
"""

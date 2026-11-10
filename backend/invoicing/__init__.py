"""invoicing app — invoices, estimates, payments (Phase 19).

Three tenant-scoped models:

* :class:`Invoice` — the canonical invoice row with line_items JSON,
  status lifecycle (draft → sent → paid / overdue / cancelled).
* :class:`Estimate` — same shape as :class:`Invoice` but the status
  set is draft / sent / accepted / rejected.
* :class:`Payment` — a payment applied to an :class:`Invoice`
  (amount / method / paid_at / reference).
"""

"""marketing app — campaigns, subscriber lists, marketing emails (Phase 19).

Three tenant-scoped models:

* :class:`Campaign` — a marketing campaign with type (email/social/sms),
  status (draft/scheduled/running/completed), date range, and a metrics
  JSON blob.
* :class:`SubscriberList` — a named subscriber list with a count + a
  JSON array of subscribers.
* :class:`MarketingEmail` — a sent email tied to a :class:`Campaign`
  with sent/open/click counters.
"""

"""projects app — project management (Phase 19).

Three tenant-scoped models:

* :class:`Project` — a tenant project with status + manager.
* :class:`ProjectTask` — a task inside a :class:`Project`, with an
  optional assignee, due date, and estimated/actual hour counters.
* :class:`TimeEntry` — a logged time slice against a :class:`Project`
  (and optionally a :class:`ProjectTask`), billable flag.
"""

"""hr app — employees, leave requests, expense claims (Phase 19).

Three tenant-scoped models:

* :class:`Employee` — a tenant employee (linked to a :class:`User`
  optionally), with department / designation / join date / status.
* :class:`LeaveRequest` — an employee's leave request with type, date
  range, and approval lifecycle (pending → approved / rejected).
* :class:`ExpenseClaim` — an employee's expense claim with amount,
  category, receipt URL, and approval lifecycle (pending → approved /
  rejected / paid).
"""

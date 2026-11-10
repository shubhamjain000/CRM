"""security_monitoring app — security events + alerts (Phase 20).

Two tenant-scoped models:

* :class:`SecurityEvent` — raw security event stream (event_type /
  severity / description / ip / metadata JSON).
* :class:`SecurityAlert` — derived alert linked to a :class:`SecurityEvent`
  with status (open / acknowledged / resolved) and ``acknowledged_by``
  FK.
"""

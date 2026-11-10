"""backup app — tenant backup records + restore stub (Phase 20).

Single tenant-scoped model:

* :class:`BackupRecord` — metadata row for a tenant backup snapshot
  (type full / incremental / wal, status, size, s3_key, timing window).
  Created by the ``backup-daily-full`` Celery beat task at 02:00 UTC.
"""

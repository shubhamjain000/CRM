"""anomaly_detection app — CRM anomaly scanning (Phase 18).

Hourly Celery beat task ``anomaly-scan`` walks the tenant's CRM data
looking for unusual patterns: deal-amount drops, rep-activity drops,
lead-response-time breaches, etc. Each detected anomaly is recorded as
an :class:`Anomaly` row; high / critical severities fire a notification
via the :mod:`notifications` app.
"""

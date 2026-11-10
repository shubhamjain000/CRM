"""Escalation-rules app — auto-escalate records that breach an SLA.

Phase 10 introduces the rule-engine layer. The ``escalation_rules`` app
adds a tenant-scoped :class:`EscalationRule` model + a service layer that
runs every 15 minutes (Celery beat) and finds records matching the
rule's ``criteria`` whose ``created_at`` exceeds the rule's
``time_limit_hours``. The matched records are then either reassigned to
``escalate_to`` or notify the escalate-to user (or both).
"""

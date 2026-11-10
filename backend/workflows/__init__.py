"""Workflow automation engine — Phase 11.

The ``workflows`` app provides a tenant-scoped, rule-driven automation
engine. A :class:`WorkflowRule` pairs a *trigger* (record create / update /
delete, field change, schedule, signal, webhook, manual, approval outcome,
blueprint transition) with an ordered list of :class:`WorkflowAction` rows
(18 action types: send_email, update_field, create_record, create_task,
webhook, custom_function, alert, assign_record, send_sms, whatsapp, delay,
if_else, loop, http, add_tag, remove_tag, subscribe_sequence, notify_team).

Trigger evaluation runs on a Celery worker (enqueued by
:mod:`workflows.signals` for record events, by the beat task for schedules,
or by viewset ``test_run`` for manual dry-runs). Every execution is logged
in :class:`WorkflowExecution` with a per-action ``actions_executed`` log.
"""

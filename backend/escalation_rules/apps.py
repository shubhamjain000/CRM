"""Django app config for the escalation_rules module.

:meth:`EscalationRulesConfig.ready` is intentionally empty — the
escalation engine is driven entirely by the Celery beat task
:func:`escalation_rules.tasks.run_escalation_check`; no signal receivers
are needed.
"""

from __future__ import annotations

from django.apps import AppConfig


class EscalationRulesConfig(AppConfig):
    """App config for ``escalation_rules``."""

    name = "escalation_rules"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Escalation Rules"

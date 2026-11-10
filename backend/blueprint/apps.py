"""Django app config for the blueprint module.

The blueprint app is the Zoho-Blueprint-equivalent engine that sits on top
of the Phase-8 pipeline graph. A :class:`blueprint.models.Blueprint` binds
to a :class:`deals.models_pipeline.Pipeline` and adds:

* **States** — one per pipeline :class:`Stage` plus typed state metadata
  (``normal`` / ``transitional`` / ``terminal``), entry / exit action
  lists, an optional time-limit, and an optional escalation blueprint.
* **Transitions** — directed edges between states carrying role
  allow-lists, JSON condition rules, required fields, an optional
  approval gate, and post-transition action lists.
* **Field requirements** + **assignments** — structured sub-rows on a
  transition (one per required field / assignment).
* **Timers** — per-state timers that auto-transition, notify, or
  escalate when the deal overstays the state.
* **Executions** — the runtime state machine for a single :class:`Deal`
  (current state, entered-at timestamp, history log, completion flag).

:meth:`BlueprintConfig.ready` imports :mod:`blueprint.signals` so the
``post_save`` receiver on :class:`deals.models.Deal` (auto-create an
execution when a deal lands in a pipeline that has an active blueprint)
is connected as soon as the app registry is ready.
"""

from __future__ import annotations

from django.apps import AppConfig


class BlueprintConfig(AppConfig):
    """App config for ``blueprint``."""

    name = "blueprint"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Blueprints"

    def ready(self) -> None:  # pragma: no cover — import-time side effect
        # Importing the signals module connects the @receiver-decorated
        # Deal post_save handler (auto-create a BlueprintExecution when a
        # deal is created in a pipeline that has an active blueprint).
        from . import signals  # noqa: F401

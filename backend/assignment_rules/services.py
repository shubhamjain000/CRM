"""Assignment-rule service layer.

The :class:`AssignmentService` is the canonical interface:

* :meth:`evaluate_rules` — find the first matching active rule for the
  record, execute its strategy, and return the user id.
* :meth:`execute_strategy` — run a single rule's strategy and return the
  resolved user id.
* :meth:`assign` — wrap :meth:`evaluate_rules`, update the record's
  ``owner``, and log an :class:`AssignmentHistory` row.

Strategies
----------

* ``round_robin`` — track the last assignment via
  :class:`AssignmentHistory` and pick the next user in ``assign_to``.
* ``lead_balance`` — count open records per user in ``assign_to`` and
  pick the fewest.
* ``territory`` — look up ``record[territory_field]`` in
  ``assign_to.user_map``.
* ``custom`` — evaluate ``assign_to.expression`` with the record's
  fields as locals and expect a user id back.

The service is deliberately stateless — callers pass a plain dict of
record fields (the same shape Django's ``model_to_dict`` produces). The
``post_save`` signal in :mod:`assignment_rules.signals` enqueues a Celery
task that calls :meth:`assign` on every Lead / Contact / Account / Deal
create.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from django.db import transaction
from django.db.models import Model
from django.utils import timezone

from assignment_rules.models import (
    AssignmentHistory,
    AssignmentRule,
    STRATEGY_CUSTOM,
    STRATEGY_LEAD_BALANCE,
    STRATEGY_ROUND_ROBIN,
    STRATEGY_TERRITORY,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User

log = logging.getLogger(__name__)


###############################################################################
# Service
###############################################################################


class AssignmentService:
    """Stateless service encapsulating the assignment-rule engine."""

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _record_matches_criteria(record_data: dict[str, Any], criteria: dict[str, Any]) -> bool:
        """Return ``True`` when ``record_data`` matches every ``criteria`` clause.

        Exact-match semantics: each ``criteria[field] == record_data[field]``
        comparison is string-coerced so int / Decimal / FK-id all match
        cleanly.
        """
        if not criteria:
            return True
        for field_name, expected in criteria.items():
            actual = record_data.get(field_name)
            if str(actual) != str(expected):
                return False
        return True

    @staticmethod
    def _resolve_model(target_model: str) -> type[Model] | None:
        """Map a ``target_model`` string to a Django model class."""
        from accounts.models import Account
        from contacts.models import Contact
        from deals.models import Deal
        from leads.models import Lead

        mapping = {
            "deal": Deal,
            "lead": Lead,
            "contact": Contact,
            "account": Account,
        }
        return mapping.get(target_model)

    # ------------------------------------------------------------------ evaluate_rules

    def evaluate_rules(
        self,
        record_module: str,
        record_data: dict[str, Any],
    ) -> tuple[AssignmentRule | None, "User | None"]:
        """Find the first matching active rule and execute its strategy.

        Returns ``(rule, user)``. When no rule matches, returns
        ``(None, None)``. When a rule matches but the strategy fails to
        resolve a user, returns ``(rule, fallback_user or None)``.
        """
        rules = AssignmentRule.objects.filter(
            target_model=record_module, is_active=True
        ).order_by("id")
        for rule in rules:
            if not self._record_matches_criteria(record_data, rule.criteria):
                continue
            user = self.execute_strategy(rule, record_data)
            if user is not None:
                return rule, user
            # Fall through to the fallback_user before moving to the next rule.
            if rule.fallback_user_id is not None:
                return rule, rule.fallback_user
        return None, None

    # ------------------------------------------------------------------ execute_strategy

    def execute_strategy(self, rule: AssignmentRule, record_data: dict[str, Any]) -> "User | None":
        """Run a single rule's strategy and return the resolved user (or ``None``)."""
        from api.models import User

        if rule.strategy == STRATEGY_ROUND_ROBIN:
            return self._strategy_round_robin(rule, record_data)
        if rule.strategy == STRATEGY_LEAD_BALANCE:
            return self._strategy_lead_balance(rule, record_data)
        if rule.strategy == STRATEGY_TERRITORY:
            return self._strategy_territory(rule, record_data)
        if rule.strategy == STRATEGY_CUSTOM:
            return self._strategy_custom(rule, record_data)
        log.warning("AssignmentRule %s has unknown strategy %s", rule.pk, rule.strategy)
        return None

    def _strategy_round_robin(
        self, rule: AssignmentRule, record_data: dict[str, Any]
    ) -> "User | None":
        """Pick the next user in ``assign_to`` after the last assignment."""
        from api.models import User

        user_ids = self._coerce_user_id_list(rule.assign_to)
        if not user_ids:
            return None
        # Find the last assignment this rule made for this target model.
        last = (
            AssignmentHistory.objects.filter(
                rule=rule, record_module=rule.target_model
            )
            .order_by("-assigned_at")
            .first()
        )
        if last is None or last.assigned_to_id not in user_ids:
            next_id = user_ids[0]
        else:
            try:
                idx = user_ids.index(last.assigned_to_id)
            except ValueError:
                next_id = user_ids[0]
            else:
                next_id = user_ids[(idx + 1) % len(user_ids)]
        return User.objects.filter(pk=next_id, is_active_account=True).first()

    def _strategy_lead_balance(
        self, rule: AssignmentRule, record_data: dict[str, Any]
    ) -> "User | None":
        """Pick the user in ``assign_to`` with the fewest open records."""
        from api.models import User

        user_ids = self._coerce_user_id_list(rule.assign_to)
        if not user_ids:
            return None
        model_cls = self._resolve_model(rule.target_model)
        if model_cls is None:
            return User.objects.filter(pk=user_ids[0], is_active_account=True).first()
        # Count open records per user. ``open`` means the record's
        # ``deleted_at`` is null (handled by the soft-delete manager) and
        # — when the model has a ``is_closed`` / ``is_converted`` flag —
        # that flag is False / unset. The lightweight implementation just
        # counts every row owned by the user.
        counts: dict[int, int] = {}
        for uid in user_ids:
            counts[uid] = model_cls.objects.filter(owner_id=uid).count()
        # Pick the user with the fewest; ties broken by the order in
        # ``assign_to``.
        min_count = min(counts.values()) if counts else 0
        for uid in user_ids:
            if counts.get(uid, 0) == min_count:
                user = User.objects.filter(pk=uid, is_active_account=True).first()
                if user is not None:
                    return user
        return None

    def _strategy_territory(
        self, rule: AssignmentRule, record_data: dict[str, Any]
    ) -> "User | None":
        """Look up ``record[territory_field]`` in ``assign_to.user_map``."""
        from api.models import User

        if not rule.territory_field:
            log.warning(
                "AssignmentRule %s strategy=territory but territory_field is empty.",
                rule.pk,
            )
            return None
        value = record_data.get(rule.territory_field)
        if value is None:
            return None
        cfg = rule.assign_to if isinstance(rule.assign_to, dict) else {}
        user_map = cfg.get("user_map", {})
        # String-coerced lookup so int / Decimal / FK-id all match cleanly.
        user_id = user_map.get(str(value))
        if user_id is None:
            return None
        try:
            uid = int(user_id)
        except (TypeError, ValueError):
            return None
        return User.objects.filter(pk=uid, is_active_account=True).first()

    def _strategy_custom(
        self, rule: AssignmentRule, record_data: dict[str, Any]
    ) -> "User | None":
        """Evaluate ``assign_to.expression`` and expect a user id back."""
        from api.models import User

        cfg = rule.assign_to if isinstance(rule.assign_to, dict) else {}
        expression = cfg.get("expression", "")
        if not expression:
            return None
        safe_builtins = {
            "abs": abs,
            "all": all,
            "any": any,
            "bool": bool,
            "dict": dict,
            "enumerate": enumerate,
            "float": float,
            "int": int,
            "len": len,
            "list": list,
            "max": max,
            "min": min,
            "round": round,
            "set": set,
            "str": str,
            "sum": sum,
            "tuple": tuple,
            "True": True,
            "False": False,
            "None": None,
        }
        namespace = {"record": record_data, "__builtins__": safe_builtins}
        try:
            user_id = eval(expression, namespace, {})  # noqa: S307 — curated namespace
        except Exception as exc:  # pragma: no cover — defensive
            log.warning("AssignmentRule %s custom expression failed: %s", rule.pk, exc)
            return None
        if user_id is None:
            return None
        try:
            uid = int(user_id)
        except (TypeError, ValueError):
            return None
        return User.objects.filter(pk=uid, is_active_account=True).first()

    @staticmethod
    def _coerce_user_id_list(assign_to: Any) -> list[int]:
        """Coerce ``assign_to`` into a list of integer user ids."""
        if not isinstance(assign_to, list):
            return []
        out: list[int] = []
        for raw in assign_to:
            try:
                out.append(int(raw))
            except (TypeError, ValueError):
                continue
        return out

    # ------------------------------------------------------------------ assign

    def assign(
        self,
        *,
        record_module: str,
        record_id: str | int,
        record_data: dict[str, Any],
    ) -> AssignmentHistory | None:
        """Evaluate the rules and update the record's ``owner``.

        Returns the :class:`AssignmentHistory` row (or ``None`` when no
        rule matched). The actual record update is done by fetching the
        row and calling ``save(update_fields=["owner", "updated_at"])``
        so the signal doesn't fire recursively.
        """
        rule, user = self.evaluate_rules(record_module, record_data)
        if user is None:
            return None
        model_cls = self._resolve_model(record_module)
        if model_cls is None:
            return None
        record = model_cls.objects.filter(pk=record_id).first()
        if record is None:
            return None
        with transaction.atomic():
            record.owner = user
            record.save(update_fields=["owner", "updated_at"])
            tenant = getattr(record, "tenant", None)
            history = AssignmentHistory.objects.create(
                tenant=tenant,
                rule=rule,
                record_module=record_module,
                record_id=str(record_id),
                assigned_to=user,
                assigned_at=timezone.now(),
            )
        return history


__all__ = ["AssignmentService"]

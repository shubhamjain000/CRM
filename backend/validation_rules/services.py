"""Validation-rule service layer.

The :class:`ValidationService` is the canonical interface:

* :meth:`evaluate_rule` — evaluate a single rule against a record dict.
  Returns ``{valid, message}``.
* :meth:`validate_record` — run every active rule for the target model
  against the record dict. Returns a list of
  :class:`ValidationViolation` named tuples.
* :meth:`bulk_check` — iterate every existing record of the target model
  and run :meth:`validate_record` against it. Returns a flat list of
  violations across the whole tenant.

The service is deliberately stateless — callers pass a plain dict of
record fields (the same shape Django's ``model_to_dict`` produces). The
``pre_save`` signal in :mod:`validation_rules.signals` calls
:meth:`validate_record` on every Lead / Contact / Account / Deal save
and raises ``ValidationError`` when any error-severity rule is violated.
"""

from __future__ import annotations

import logging
import re
from collections import namedtuple
from decimal import Decimal, InvalidOperation
from typing import Any

from django.core.exceptions import ValidationError
from django.db.models import Model

from validation_rules.models import (
    CONDITION_CUSTOM,
    CONDITION_RANGE,
    CONDITION_REGEX,
    CONDITION_REQUIRED,
    CONDITION_UNIQUE,
    SEVERITY_ERROR,
    SEVERITY_WARNING,
    TRIGGER_BOTH,
    TRIGGER_UPDATE,
    ValidationRule,
)

log = logging.getLogger(__name__)


###############################################################################
# Public data structures
###############################################################################


#: A single rule-violation result returned by :meth:`ValidationService.validate_record`.
ValidationViolation = namedtuple(
    "ValidationViolation",
    ["rule_id", "target_model", "field_name", "condition_type", "severity", "message"],
)


###############################################################################
# Service
###############################################################################


class ValidationService:
    """Stateless service encapsulating the validation-rule engine.

    All public methods accept plain dicts (and the optional ORM model
    instance for ``bulk_check``) so the service is straightforward to
    unit-test without an HTTP layer.
    """

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _field_value(record_data: dict[str, Any], field_name: str) -> Any:
        """Read ``field_name`` from ``record_data`` (None when missing)."""
        return record_data.get(field_name)

    @staticmethod
    def _is_empty(value: Any) -> bool:
        """Return ``True`` when ``value`` is considered empty."""
        return value in (None, "", [], {})

    @staticmethod
    def _coerce_decimal(value: Any) -> Decimal | None:
        """Best-effort coercion of ``value`` into a :class:`Decimal`."""
        if value is None or value == "":
            return None
        try:
            return Decimal(str(value))
        except (InvalidOperation, ValueError):
            return None

    @staticmethod
    def _applies_to_trigger(rule: ValidationRule, trigger: str) -> bool:
        """Return ``True`` when ``rule`` should fire for the given ``trigger``."""
        if rule.trigger_on == TRIGGER_BOTH:
            return True
        return rule.trigger_on == trigger

    # ------------------------------------------------------------------ evaluate_rule

    def evaluate_rule(self, rule: ValidationRule, record_data: dict[str, Any]) -> dict[str, Any]:
        """Evaluate a single rule against ``record_data``.

        Returns ``{"valid": bool, "message": str}``. ``message`` is the
        rule's ``error_message`` when ``valid`` is ``False``; empty
        otherwise.
        """
        value = self._field_value(record_data, rule.field_name)
        ok = True
        if rule.condition_type == CONDITION_REQUIRED:
            ok = not self._is_empty(value)
        elif rule.condition_type == CONDITION_REGEX:
            ok = self._eval_regex(rule, value)
        elif rule.condition_type == CONDITION_RANGE:
            ok = self._eval_range(rule, value)
        elif rule.condition_type == CONDITION_UNIQUE:
            # ``unique`` cannot be evaluated without the model + record id;
            # the service treats it as satisfied here and the actual
            # uniqueness check is performed by :meth:`validate_record`.
            ok = True
        elif rule.condition_type == CONDITION_CUSTOM:
            ok = self._eval_custom(rule, value, record_data)
        return {"valid": ok, "message": "" if ok else (rule.error_message or "Validation failed.")}

    def _eval_regex(self, rule: ValidationRule, value: Any) -> bool:
        pattern = (rule.condition_value or {}).get("regex", "")
        if not pattern or self._is_empty(value):
            return self._is_empty(value)  # empty value when no regex is fine
        try:
            return re.fullmatch(pattern, str(value)) is not None
        except re.error as exc:
            log.warning("ValidationRule %s has invalid regex %r: %s", rule.pk, pattern, exc)
            return True

    def _eval_range(self, rule: ValidationRule, value: Any) -> bool:
        if self._is_empty(value):
            return True  # range is not a required check
        left = self._coerce_decimal(value)
        if left is None:
            return False
        cfg = rule.condition_value or {}
        min_v = cfg.get("min")
        max_v = cfg.get("max")
        if min_v is not None:
            right = self._coerce_decimal(min_v)
            if right is not None and left < right:
                return False
        if max_v is not None:
            right = self._coerce_decimal(max_v)
            if right is not None and left > right:
                return False
        return True

    def _eval_custom(self, rule: ValidationRule, value: Any, record_data: dict[str, Any]) -> bool:
        expression = (rule.condition_value or {}).get("expression", "")
        if not expression:
            return True
        # Eval the expression with a minimal, safe namespace. ``value`` is
        # the field's value, ``record`` is the full record dict. Builtins
        # are limited to a curated subset so callers can't ``__import__``.
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
        namespace = {"value": value, "record": record_data, "__builtins__": safe_builtins}
        try:
            return bool(eval(expression, namespace, {}))  # noqa: S307 — curated namespace
        except Exception as exc:  # pragma: no cover — defensive
            log.warning("ValidationRule %s custom expression failed: %s", rule.pk, exc)
            return True

    # ------------------------------------------------------------------ validate_record

    def validate_record(
        self,
        model: str,
        record_data: dict[str, Any],
        *,
        trigger: str = TRIGGER_BOTH,
        record_id: int | str | None = None,
        instance: Model | None = None,
    ) -> list[ValidationViolation]:
        """Run every active rule for ``model`` against ``record_data``.

        Returns a list of :class:`ValidationViolation` for every rule
        that failed. ``record_id`` + ``instance`` are used for the
        ``unique`` check (the rule is violated when another row with the
        same field value exists in the tenant).

        Pass ``trigger='create'`` or ``trigger='update'`` to filter rules
        by ``trigger_on``. The default ``both`` matches every rule.
        """
        violations: list[ValidationViolation] = []
        rules = ValidationRule.objects.filter(
            target_model=model, is_active=True
        ).order_by("id")
        for rule in rules:
            if not self._applies_to_trigger(rule, trigger):
                continue
            if rule.condition_type == CONDITION_UNIQUE:
                ok = self._eval_unique(rule, instance, record_data, record_id)
                if not ok:
                    violations.append(
                        ValidationViolation(
                            rule_id=rule.pk,
                            target_model=model,
                            field_name=rule.field_name,
                            condition_type=rule.condition_type,
                            severity=rule.error_severity,
                            message=rule.error_message or f"{rule.field_name} must be unique.",
                        )
                    )
                continue
            result = self.evaluate_rule(rule, record_data)
            if not result["valid"]:
                violations.append(
                    ValidationViolation(
                        rule_id=rule.pk,
                        target_model=model,
                        field_name=rule.field_name,
                        condition_type=rule.condition_type,
                        severity=rule.error_severity,
                        message=result["message"],
                    )
                )
        return violations

    def _eval_unique(
        self,
        rule: ValidationRule,
        instance: Model | None,
        record_data: dict[str, Any],
        record_id: int | str | None,
    ) -> bool:
        """Return ``True`` when no other row of the same model has the same value.

        Resolves the model class from ``rule.target_model`` (deal → Deal,
        lead → Lead, etc.), queries the tenant-scoped queryset for rows
        with the same field value, and excludes the current ``instance``
        / ``record_id``. Returns ``True`` when no match is found.
        """
        value = self._field_value(record_data, rule.field_name)
        if self._is_empty(value):
            return True  # unique is not a required check
        model_cls = self._resolve_model(rule.target_model)
        if model_cls is None:
            return True
        qs = model_cls.objects.filter(**{rule.field_name: value})
        if instance is not None and instance.pk is not None:
            qs = qs.exclude(pk=instance.pk)
        elif record_id is not None:
            qs = qs.exclude(pk=record_id)
        return not qs.exists()

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

    # ------------------------------------------------------------------ bulk_check

    def bulk_check(self, model: str) -> list[ValidationViolation]:
        """Iterate every existing record of ``model`` and run :meth:`validate_record`.

        Returns a flat list of violations across the whole tenant. Useful
        for the "data quality" UI panel that surfaces dirty records after
        a new rule is published.
        """
        model_cls = self._resolve_model(model)
        if model_cls is None:
            return []
        out: list[ValidationViolation] = []
        for record in model_cls.objects.all().iterator(chunk_size=200):
            record_data = self._record_to_dict(record)
            violations = self.validate_record(
                model,
                record_data,
                trigger=TRIGGER_UPDATE,
                instance=record,
                record_id=record.pk,
            )
            out.extend(violations)
        return out

    @staticmethod
    def _record_to_dict(record: Model) -> dict[str, Any]:
        """Best-effort field projection for ``record``.

        Mirrors ``model_to_dict`` but keeps the raw field values (so
        Decimal / date objects aren't stringified prematurely).
        """
        out: dict[str, Any] = {}
        for field in record._meta.concrete_fields:  # type: ignore[attr-defined]
            try:
                out[field.name] = getattr(record, field.attname)
            except Exception:  # pragma: no cover — defensive
                continue
        return out

    # ------------------------------------------------------------------ enforce

    def enforce(self, model: str, record_data: dict[str, Any], *, trigger: str) -> None:
        """Run :meth:`validate_record` and raise ``ValidationError`` on error-severity failures.

        Used by the ``pre_save`` signal in :mod:`validation_rules.signals`.
        Warning-severity failures are logged but do not raise.
        """
        violations = self.validate_record(model, record_data, trigger=trigger)
        errors = [v.message for v in violations if v.severity == SEVERITY_ERROR]
        warnings = [v.message for v in violations if v.severity == SEVERITY_WARNING]
        if warnings:
            log.info(
                "ValidationService.enforce: %d warnings for %s (%s)",
                len(warnings), model, "; ".join(warnings),
            )
        if errors:
            raise ValidationError(errors)


__all__ = ["ValidationService", "ValidationViolation"]

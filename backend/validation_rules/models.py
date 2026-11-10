"""Validation-rule models — runtime field validators for CRM records.

A :class:`ValidationRule` is a tenant-scoped, per-field, per-condition
rule that fires on ``create`` / ``update`` / ``both``. The rule's
``condition_type`` drives the evaluation:

* ``required`` — the field must be non-empty.
* ``regex`` — the field's string value must match ``condition_value.regex``.
* ``range`` — the field's numeric value must be within
  ``[condition_value.min, condition_value.max]`` (inclusive).
* ``unique`` — the field's value must be unique within the tenant for the
  target model.
* ``custom`` — the field's value must satisfy ``condition_value.expression``
  (a Python expression evaluated with the record's fields as locals).

``error_severity`` is one of ``error`` (raises ``ValidationError`` and
blocks the save) or ``warning`` (logged but does not block).
"""

from __future__ import annotations

from django.db import models

from api.models import TenantModel


###############################################################################
# Constants
###############################################################################


#: Condition-type choices for :class:`ValidationRule.condition_type`.
CONDITION_REQUIRED = "required"
CONDITION_REGEX = "regex"
CONDITION_RANGE = "range"
CONDITION_UNIQUE = "unique"
CONDITION_CUSTOM = "custom"
CONDITION_TYPE_CHOICES = [
    (CONDITION_REQUIRED, "Required"),
    (CONDITION_REGEX, "Regex"),
    (CONDITION_RANGE, "Range"),
    (CONDITION_UNIQUE, "Unique"),
    (CONDITION_CUSTOM, "Custom"),
]

#: Error-severity choices for :class:`ValidationRule.error_severity`.
SEVERITY_ERROR = "error"
SEVERITY_WARNING = "warning"
SEVERITY_CHOICES = [
    (SEVERITY_ERROR, "Error"),
    (SEVERITY_WARNING, "Warning"),
]

#: Trigger choices for :class:`ValidationRule.trigger_on`.
TRIGGER_CREATE = "create"
TRIGGER_UPDATE = "update"
TRIGGER_BOTH = "both"
TRIGGER_CHOICES = [
    (TRIGGER_CREATE, "Create"),
    (TRIGGER_UPDATE, "Update"),
    (TRIGGER_BOTH, "Both"),
]


###############################################################################
# ValidationRule
###############################################################################


class ValidationRule(TenantModel):
    """A tenant-scoped, per-field, per-condition validation rule.

    ``condition_value`` shape depends on ``condition_type``:

    * ``required`` — ``{}`` (no extra params).
    * ``regex`` — ``{"regex": "^[A-Z][a-z]+$"}``.
    * ``range`` — ``{"min": 0, "max": 100}`` (either optional).
    * ``unique`` — ``{}`` (no extra params; uniqueness is per-tenant per-model).
    * ``custom`` — ``{"expression": "value > 0 and value < 1000"}`` —
      evaluated with ``value`` (the field's value), ``record`` (the dict
      of fields the service was called with), and ``__builtins__`` in
      scope. Use sparingly — custom expressions are a security-sensitive
      surface.
    """

    target_model = models.CharField(
        max_length=32,
        db_index=True,
        help_text="Which CRM entity this rule applies to (deal / lead / contact / account).",
    )
    field_name = models.CharField(
        max_length=128,
        help_text="The field on the target model the rule evaluates against.",
    )
    condition_type = models.CharField(
        max_length=32,
        choices=CONDITION_TYPE_CHOICES,
        default=CONDITION_REQUIRED,
        db_index=True,
    )
    condition_value = models.JSONField(
        default=dict,
        blank=True,
        help_text="Condition-type-specific parameters (see class docstring).",
    )
    error_message = models.CharField(
        max_length=255,
        help_text="User-facing message displayed when the rule fails.",
    )
    error_severity = models.CharField(
        max_length=16,
        choices=SEVERITY_CHOICES,
        default=SEVERITY_ERROR,
        db_index=True,
    )
    trigger_on = models.CharField(
        max_length=16,
        choices=TRIGGER_CHOICES,
        default=TRIGGER_BOTH,
        db_index=True,
    )
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "validation_rules_validationrule"
        verbose_name = "validation rule"
        verbose_name_plural = "validation rules"
        indexes = [
            models.Index(
                fields=["tenant", "target_model", "is_active"],
                name="vrule_target_active_idx",
            ),
        ]

    def __str__(self) -> str:
        return (
            f"{self.target_model}.{self.field_name} {self.condition_type} "
            f"({self.error_severity})"
        )


__all__ = [
    "CONDITION_CUSTOM",
    "CONDITION_RANGE",
    "CONDITION_REGEX",
    "CONDITION_REQUIRED",
    "CONDITION_TYPE_CHOICES",
    "CONDITION_UNIQUE",
    "SEVERITY_CHOICES",
    "SEVERITY_ERROR",
    "SEVERITY_WARNING",
    "TRIGGER_BOTH",
    "TRIGGER_CHOICES",
    "TRIGGER_CREATE",
    "TRIGGER_UPDATE",
    "ValidationRule",
]

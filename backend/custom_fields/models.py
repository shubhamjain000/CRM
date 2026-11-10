"""Custom field models.

``CustomField`` defines a per-tenant, per-module field with one of 25 types.
``CustomFieldValue`` stores the JSON value of a custom field for a particular
record. Values are linked by ``record_id`` (a stringified UUID/pk) so the
generic relation works across all CRM models without a content_type FK.
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models

from api.models import Organization, TimestampedModel
from api.soft_delete import AllObjectsManager, SoftDeleteTenantManager

# The 25 supported custom field types.
FIELD_TYPE_TEXT = "text"
FIELD_TYPE_LONG_TEXT = "long_text"
FIELD_TYPE_RICH_TEXT = "rich_text"
FIELD_TYPE_NUMBER = "number"
FIELD_TYPE_CURRENCY = "currency"
FIELD_TYPE_PERCENT = "percent"
FIELD_TYPE_DECIMAL = "decimal"
FIELD_TYPE_DATE = "date"
FIELD_TYPE_DATETIME = "datetime"
FIELD_TYPE_TIME = "time"
FIELD_TYPE_EMAIL = "email"
FIELD_TYPE_PHONE = "phone"
FIELD_TYPE_URL = "url"
FIELD_TYPE_PICKLIST = "picklist"
FIELD_TYPE_MULTI_PICKLIST = "multi_picklist"
FIELD_TYPE_CHECKBOX = "checkbox"
FIELD_TYPE_LOOKUP = "lookup"
FIELD_TYPE_SUBFORM = "subform"
FIELD_TYPE_FORMULA = "formula"
FIELD_TYPE_ROLLUP_SUMMARY = "rollup_summary"
FIELD_TYPE_FILE = "file"
FIELD_TYPE_IMAGE = "image"
FIELD_TYPE_RATING = "rating"
FIELD_TYPE_ADDRESS = "address"

FIELD_TYPE_CHOICES = [
    (FIELD_TYPE_TEXT, "Text"),
    (FIELD_TYPE_LONG_TEXT, "Long Text"),
    (FIELD_TYPE_RICH_TEXT, "Rich Text"),
    (FIELD_TYPE_NUMBER, "Number"),
    (FIELD_TYPE_CURRENCY, "Currency"),
    (FIELD_TYPE_PERCENT, "Percent"),
    (FIELD_TYPE_DECIMAL, "Decimal"),
    (FIELD_TYPE_DATE, "Date"),
    (FIELD_TYPE_DATETIME, "Datetime"),
    (FIELD_TYPE_TIME, "Time"),
    (FIELD_TYPE_EMAIL, "Email"),
    (FIELD_TYPE_PHONE, "Phone"),
    (FIELD_TYPE_URL, "URL"),
    (FIELD_TYPE_PICKLIST, "Picklist"),
    (FIELD_TYPE_MULTI_PICKLIST, "Multi Picklist"),
    (FIELD_TYPE_CHECKBOX, "Checkbox"),
    (FIELD_TYPE_LOOKUP, "Lookup"),
    (FIELD_TYPE_SUBFORM, "Subform"),
    (FIELD_TYPE_FORMULA, "Formula"),
    (FIELD_TYPE_ROLLUP_SUMMARY, "Rollup Summary"),
    (FIELD_TYPE_FILE, "File"),
    (FIELD_TYPE_IMAGE, "Image"),
    (FIELD_TYPE_RATING, "Rating"),
    (FIELD_TYPE_ADDRESS, "Address"),
]

MODULE_LEAD = "lead"
MODULE_CONTACT = "contact"
MODULE_ACCOUNT = "account"
MODULE_DEAL = "deal"
MODULE_CHOICES = [
    (MODULE_LEAD, "Lead"),
    (MODULE_CONTACT, "Contact"),
    (MODULE_ACCOUNT, "Account"),
    (MODULE_DEAL, "Deal"),
]

_API_NAME_VALIDATOR = RegexValidator(
    regex=r"^[a-z][a-z0-9_]{1,62}$",
    message="api_name must be lowercase, start with a letter, and use only [a-z0-9_].",
)


class CustomField(TimestampedModel):
    """A per-tenant, per-module custom field definition.

    The set of supported ``field_type``s is enumerated above (25 types).
    ``field_options`` is a JSON blob whose shape depends on the type — e.g.
    ``{"choices": ["A", "B"]}`` for picklists, ``{"target_module": "account"}``
    for lookups.
    """

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="custom_fields",
        db_index=True,
    )
    module = models.CharField(max_length=16, choices=MODULE_CHOICES, db_index=True)
    label = models.CharField(max_length=128)
    api_name = models.CharField(max_length=64, validators=[_API_NAME_VALIDATOR], db_index=True)
    field_type = models.CharField(max_length=32, choices=FIELD_TYPE_CHOICES)
    field_options = models.JSONField(default=dict, blank=True)
    validation_rules = models.JSONField(default=dict, blank=True)
    default_value = models.TextField(blank=True, default="")
    is_required = models.BooleanField(default=False)
    is_unique = models.BooleanField(default=False)
    is_searchable = models.BooleanField(default=False, db_index=True)
    description = models.TextField(blank=True, default="")

    objects = SoftDeleteTenantManager()
    all_objects = AllObjectsManager()
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "custom_fields_customfield"
        verbose_name = "custom field"
        verbose_name_plural = "custom fields"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "module", "api_name"],
                name="custom_field_unique_api_name_per_module",
            ),
            models.CheckConstraint(
                condition=models.Q(module__in=("lead", "contact", "account", "deal")),
                name="custom_field_module_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "module", "api_name"], name="cf_module_api_idx"),
            models.Index(fields=["tenant", "module", "is_searchable"], name="cf_module_search_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.module}.{self.api_name} ({self.field_type})"

    def clean(self) -> None:  # type: ignore[override]
        super().clean()
        from .registry import REGISTRY

        if self.field_type and self.field_type not in REGISTRY:
            raise ValidationError({"field_type": f"Unsupported field_type: {self.field_type}"})
        if self.field_type in {FIELD_TYPE_PICKLIST, FIELD_TYPE_MULTI_PICKLIST}:
            choices = (self.field_options or {}).get("choices")
            if not isinstance(choices, list) or not choices:
                raise ValidationError(
                    {"field_options": "picklist/multi_picklist require a non-empty 'choices' list."}
                )
        if self.field_type == FIELD_TYPE_LOOKUP:
            target = (self.field_options or {}).get("target_module")
            if target not in {"lead", "contact", "account", "deal"}:
                raise ValidationError(
                    {"field_options": "lookup requires 'target_module' in {lead,contact,account,deal}."}
                )


class CustomFieldValue(TimestampedModel):
    """A custom field value for a particular record.

    ``record_id`` is a stringified UUID/pk so the same table can hold values
    for any CRM model without a content_type FK. ``value`` is a JSONField so
    it can carry any of the 25 field types.

    On PostgreSQL a GIN index on ``(module, value)`` makes value-contains
    queries fast — the migration will add it via a custom ``RunSQL`` op.
    """

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="custom_field_values",
        db_index=True,
    )
    field = models.ForeignKey(
        CustomField,
        on_delete=models.CASCADE,
        related_name="values",
    )
    module = models.CharField(max_length=16, choices=MODULE_CHOICES, db_index=True)
    record_id = models.CharField(max_length=64, db_index=True)
    value = models.JSONField(default=dict, blank=True)

    objects = SoftDeleteTenantManager()
    all_objects = AllObjectsManager()
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "custom_fields_customfieldvalue"
        verbose_name = "custom field value"
        verbose_name_plural = "custom field values"
        constraints = [
            models.UniqueConstraint(
                fields=["field", "record_id"],
                name="custom_field_value_unique_per_record",
            ),
            models.CheckConstraint(
                condition=models.Q(module__in=("lead", "contact", "account", "deal")),
                name="custom_field_value_module_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "module", "record_id"], name="cfv_module_record_idx"),
            models.Index(fields=["tenant", "module", "field"], name="cfv_module_field_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.module}:{self.record_id} → {self.field.api_name}={self.value!r}"

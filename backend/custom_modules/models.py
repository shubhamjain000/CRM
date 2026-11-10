"""Database models for the custom_modules app (Phase 17).

Three tenant-scoped models that together implement Salesforce-Custom-
Object-equivalent functionality:

* :class:`CustomModule` — module definition (name / plural_name / slug /
  icon / color / record_name_field / is_active / is_system).
* :class:`CustomModuleField` — field schema. ``field_type`` is one of
  ``text`` / ``number`` / ``email`` / ``phone`` / ``date`` / ``datetime``
  / ``picklist`` / ``multipicklist`` / ``boolean`` / ``currency`` /
  ``url`` / ``textarea`` / ``lookup`` / ``auto_number``.
  ``field_options`` carries type-specific options (picklist choices,
  lookup target module, currency code, number precision, etc.).
* :class:`CustomModuleRecord` — generic record storage. ``data`` is a
  JSONField keyed by the field ``api_name``. The record-name (display
  label) is ``data[module.record_name_field]``.
"""

from __future__ import annotations

from django.db import models

from api.models import TenantModel

###############################################################################
# Constants — field types
###############################################################################

FIELD_TEXT = "text"
FIELD_NUMBER = "number"
FIELD_EMAIL = "email"
FIELD_PHONE = "phone"
FIELD_DATE = "date"
FIELD_DATETIME = "datetime"
FIELD_PICKLIST = "picklist"
FIELD_MULTIPICKLIST = "multipicklist"
FIELD_BOOLEAN = "boolean"
FIELD_CURRENCY = "currency"
FIELD_URL = "url"
FIELD_TEXTAREA = "textarea"
FIELD_LOOKUP = "lookup"
FIELD_AUTO_NUMBER = "auto_number"

FIELD_TYPE_CHOICES = [
    (FIELD_TEXT, "Text"),
    (FIELD_NUMBER, "Number"),
    (FIELD_EMAIL, "Email"),
    (FIELD_PHONE, "Phone"),
    (FIELD_DATE, "Date"),
    (FIELD_DATETIME, "Date/Time"),
    (FIELD_PICKLIST, "Picklist"),
    (FIELD_MULTIPICKLIST, "Multi-Select Picklist"),
    (FIELD_BOOLEAN, "Boolean"),
    (FIELD_CURRENCY, "Currency"),
    (FIELD_URL, "URL"),
    (FIELD_TEXTAREA, "Text Area"),
    (FIELD_LOOKUP, "Lookup"),
    (FIELD_AUTO_NUMBER, "Auto Number"),
]

SEARCHABLE_FIELD_TYPES = {
    FIELD_TEXT, FIELD_EMAIL, FIELD_PHONE, FIELD_URL, FIELD_TEXTAREA,
    FIELD_AUTO_NUMBER,
}


###############################################################################
# CustomModule
###############################################################################


class CustomModule(TenantModel):
    """A user-defined CRM module (e.g. "Properties", "Vehicles").

    ``slug`` is unique per tenant and used as the URL fragment
    (``/api/v1/custom-modules/<slug>/records/``). ``record_name_field``
    is the ``api_name`` of the field whose value is used as the display
    label for a record (defaults to ``name``).
    """

    name = models.CharField(max_length=100, db_index=True)
    plural_name = models.CharField(max_length=100, blank=True, default="")
    slug = models.SlugField(max_length=100, db_index=True)
    icon = models.CharField(max_length=64, blank=True, default="")
    color = models.CharField(max_length=16, blank=True, default="")
    record_name_field = models.CharField(
        max_length=100, default="name",
        help_text="api_name of the field whose value labels a record.",
    )
    is_active = models.BooleanField(default=True, db_index=True)
    is_system = models.BooleanField(
        default=False,
        help_text="System modules cannot be deleted by tenants.",
    )

    class Meta:
        db_table = "custom_modules_module"
        verbose_name = "custom module"
        verbose_name_plural = "custom modules"
        unique_together = (("tenant", "slug"),)
        indexes = [
            models.Index(fields=["tenant", "is_active"], name="cm_active_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.slug})"


###############################################################################
# CustomModuleField
###############################################################################


class CustomModuleField(TenantModel):
    """A field definition on a :class:`CustomModule`.

    ``api_name`` is unique per module and is the key used in
    :class:`CustomModuleRecord.data`. ``section`` groups fields together
    in the layout UI. ``field_options`` carries type-specific config
    (e.g. ``{"choices": ["A","B","C"]}`` for picklists, ``{"target":
    "contacts"}`` for lookups, ``{"precision": 2}`` for numbers).
    """

    module = models.ForeignKey(
        CustomModule, on_delete=models.CASCADE, related_name="fields"
    )
    label = models.CharField(max_length=100)
    api_name = models.CharField(max_length=100, db_index=True)
    field_type = models.CharField(
        max_length=32, choices=FIELD_TYPE_CHOICES, default=FIELD_TEXT,
        db_index=True,
    )
    field_options = models.JSONField(default=dict, blank=True)
    default_value = models.JSONField(default=None, null=True, blank=True)
    is_required = models.BooleanField(default=False)
    is_unique = models.BooleanField(default=False)
    is_searchable = models.BooleanField(default=False)
    display_order = models.IntegerField(default=0)
    section = models.CharField(max_length=100, blank=True, default="")

    class Meta:
        db_table = "custom_modules_field"
        verbose_name = "custom module field"
        verbose_name_plural = "custom module fields"
        unique_together = (("module", "api_name"),)
        ordering = ["display_order", "id"]
        indexes = [
            models.Index(fields=["module", "section"], name="cmf_section_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.module.slug}.{self.api_name} ({self.field_type})"


###############################################################################
# CustomModuleRecord
###############################################################################


class CustomModuleRecord(TenantModel):
    """A single record in a :class:`CustomModule`.

    ``data`` is a JSONField keyed by the field ``api_name``. Validation
    against the module's field schema is performed by
    :func:`custom_modules.services.validate_record_data` — the database
    itself imposes no schema (this is the Salesforce Custom-Object
    pattern: storage is generic, validation lives in the service layer).
    """

    module = models.ForeignKey(
        CustomModule, on_delete=models.CASCADE, related_name="records"
    )
    data = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "custom_modules_record"
        verbose_name = "custom module record"
        verbose_name_plural = "custom module records"
        indexes = [
            models.Index(fields=["module", "-created_at"], name="cmr_recent_idx"),
        ]

    def __str__(self) -> str:
        name = ""
        if isinstance(self.data, dict):
            name = str(self.data.get(self.module.record_name_field, "") or "")
        return f"{self.module.slug}#{self.pk}:{name}"


__all__ = [
    "FIELD_AUTO_NUMBER",
    "FIELD_BOOLEAN",
    "FIELD_CURRENCY",
    "FIELD_DATE",
    "FIELD_DATETIME",
    "FIELD_EMAIL",
    "FIELD_MULTIPICKLIST",
    "FIELD_NUMBER",
    "FIELD_PHONE",
    "FIELD_PICKLIST",
    "FIELD_TEXT",
    "FIELD_TEXTAREA",
    "FIELD_TYPE_CHOICES",
    "FIELD_URL",
    "SEARCHABLE_FIELD_TYPES",
    "CustomModule",
    "CustomModuleField",
    "CustomModuleRecord",
]

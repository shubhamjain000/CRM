"""Database models for the custom_functions scripting engine.

All seven models are tenant-scoped (inherit :class:`api.models.TenantModel`)
and follow the established pattern (TenantManager + TimestampedModel):

* :class:`CustomFunction` — the tenant-scoped script definition (language,
  trigger_event, code, approval flag, execution / error counters).
* :class:`CustomFunctionVariable` — typed input / output variables declared
  for a function (used for template wiring + validation).
* :class:`CustomFunctionExecution` — append-only audit row for every run
  (status, input / output JSON, captured stdout, error message).
* :class:`CustomFunctionVersion` — code snapshots saved before each update
  so a function can be rolled back to any prior version.
* :class:`KVStore` — per-tenant key-value store exposed to the sandbox as
  ``kv.set/get`` (the only persistent storage the sandbox can write to).
* :class:`HttpAllowlist` — per-tenant list of domains the sandbox's ``http``
  helper is allowed to call. Empty list = no outbound HTTP.
* :class:`HttpCallLog` — per-call audit log of every outbound HTTP request
  made from inside a custom function execution.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel, User

###############################################################################
# Constants — language
###############################################################################

LANGUAGE_PYTHON = "python"
LANGUAGE_JAVASCRIPT = "javascript"
LANGUAGE_VISUAL = "visual"
LANGUAGE_CHOICES = [
    (LANGUAGE_PYTHON, "Python"),
    (LANGUAGE_JAVASCRIPT, "JavaScript"),
    (LANGUAGE_VISUAL, "Visual builder"),
]

###############################################################################
# Constants — trigger event
###############################################################################

TRIGGER_MANUAL = "manual"
TRIGGER_WEBHOOK = "webhook"
TRIGGER_WORKFLOW = "workflow"
TRIGGER_SCHEDULED = "scheduled"
TRIGGER_API = "api"
TRIGGER_CHOICES = [
    (TRIGGER_MANUAL, "Manual"),
    (TRIGGER_WEBHOOK, "Webhook"),
    (TRIGGER_WORKFLOW, "Workflow"),
    (TRIGGER_SCHEDULED, "Scheduled"),
    (TRIGGER_API, "API"),
]

###############################################################################
# Constants — execution status
###############################################################################

STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CHOICES = [
    (STATUS_RUNNING, "Running"),
    (STATUS_COMPLETED, "Completed"),
    (STATUS_FAILED, "Failed"),
]

###############################################################################
# Constants — variable metadata
###############################################################################

VAR_INPUT = "input"
VAR_OUTPUT = "output"
VAR_TYPE_CHOICES = [
    (VAR_INPUT, "Input"),
    (VAR_OUTPUT, "Output"),
]

DATA_STRING = "string"
DATA_NUMBER = "number"
DATA_BOOLEAN = "boolean"
DATA_JSON = "json"
DATA_RECORD = "record"
DATA_TYPE_CHOICES = [
    (DATA_STRING, "String"),
    (DATA_NUMBER, "Number"),
    (DATA_BOOLEAN, "Boolean"),
    (DATA_JSON, "JSON"),
    (DATA_RECORD, "Record"),
]


###############################################################################
# CustomFunction
###############################################################################


class CustomFunction(TenantModel):
    """A tenant-scoped script + trigger metadata + lifecycle counters.

    ``is_approved`` is ``False`` by default — a tenant admin must call the
    ``approve`` endpoint before a function may execute from a webhook /
    workflow / scheduled trigger. Manual + ``test`` runs are permitted
    without approval so authors can iterate on drafts.

    The sandbox dispatcher in :mod:`custom_functions.sandbox` only loads
    the ``code`` field — never the ``CustomFunctionVersion`` rows. Version
    snapshots are an audit / rollback aid, not the runtime source.
    """

    name = models.CharField(max_length=255, db_index=True)
    description = models.TextField(blank=True, default="")
    language = models.CharField(
        max_length=16, choices=LANGUAGE_CHOICES, default=LANGUAGE_PYTHON, db_index=True
    )
    trigger_event = models.CharField(
        max_length=16, choices=TRIGGER_CHOICES, default=TRIGGER_MANUAL, db_index=True
    )
    code = models.TextField(blank=True, default="")
    version = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True, db_index=True)
    is_approved = models.BooleanField(
        default=False,
        help_text="Admin approval gate — production triggers require this to be True.",
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="custom_functions",
    )
    last_executed_at = models.DateTimeField(null=True, blank=True)
    execution_count = models.PositiveIntegerField(default=0)
    error_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "custom_functions_function"
        verbose_name = "custom function"
        verbose_name_plural = "custom functions"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["tenant", "is_active", "trigger_event"],
                name="cf_active_trigger_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.language}/{self.trigger_event})"


###############################################################################
# CustomFunctionVariable
###############################################################################


class CustomFunctionVariable(TenantModel):
    """A typed input or output variable declared for a :class:`CustomFunction`.

    Declared variables are surfaced in the templates UI + used by callers
    (workflows / webhooks) to know what payload to pass / expect back. They
    are advisory: the sandbox does not enforce them at runtime.
    """

    function = models.ForeignKey(
        CustomFunction,
        on_delete=models.CASCADE,
        related_name="variables",
        db_index=True,
    )
    name = models.CharField(max_length=128)
    var_type = models.CharField(max_length=8, choices=VAR_TYPE_CHOICES, default=VAR_INPUT)
    data_type = models.CharField(
        max_length=16, choices=DATA_TYPE_CHOICES, default=DATA_STRING
    )
    description = models.TextField(blank=True, default="")
    default_value = models.TextField(blank=True, default="")
    is_required = models.BooleanField(default=False)

    class Meta:
        db_table = "custom_functions_variable"
        verbose_name = "custom function variable"
        verbose_name_plural = "custom function variables"
        ordering = ["var_type", "name"]
        indexes = [
            models.Index(fields=["function", "var_type"], name="cfvar_fn_type_idx"),
        ]
        unique_together = (("function", "name"),)

    def __str__(self) -> str:
        return f"{self.function.name}.{self.name} ({self.var_type}/{self.data_type})"


###############################################################################
# CustomFunctionExecution
###############################################################################


class CustomFunctionExecution(TenantModel):
    """Append-only audit row for a single function run.

    Created by :meth:`custom_functions.services.CustomFunctionService.execute`
    before the sandbox is invoked, updated in-place as the run completes.
    The ``function`` FK is SET_NULL so deleting a function doesn't cascade
    onto the audit log.
    """

    function = models.ForeignKey(
        CustomFunction,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="executions",
        db_index=True,
    )
    trigger = models.CharField(
        max_length=16,
        choices=TRIGGER_CHOICES,
        default=TRIGGER_MANUAL,
        db_index=True,
    )
    input_data = models.JSONField(default=dict, blank=True)
    output_data = models.JSONField(null=True, blank=True)
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_RUNNING, db_index=True
    )
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True, default="")
    log_output = models.TextField(
        blank=True,
        default="",
        help_text="Captured stdout / log.info / log.error output.",
    )
    execution_time_ms = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "custom_functions_execution"
        verbose_name = "custom function execution"
        verbose_name_plural = "custom function executions"
        ordering = ["-started_at"]
        indexes = [
            models.Index(
                fields=["tenant", "function", "started_at"],
                name="cfexec_fn_started_idx",
            ),
            models.Index(fields=["tenant", "status"], name="cfexec_status_idx"),
        ]

    def __str__(self) -> str:
        fn = self.function.name if self.function_id else "(deleted)"
        return f"{fn} → {self.status} @ {self.started_at:%Y-%m-%d %H:%M:%S}"


###############################################################################
# CustomFunctionVersion
###############################################################################


class CustomFunctionVersion(TenantModel):
    """An immutable code snapshot for a :class:`CustomFunction`.

    Written by :meth:`custom_functions.services.CustomFunctionService.save_version`
    before each update so an admin can roll back to any prior version via
    the ``restore_version`` endpoint.
    """

    function = models.ForeignKey(
        CustomFunction,
        on_delete=models.CASCADE,
        related_name="versions",
        db_index=True,
    )
    version = models.PositiveIntegerField()
    code = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="custom_function_versions",
    )

    class Meta:
        db_table = "custom_functions_version"
        verbose_name = "custom function version"
        verbose_name_plural = "custom function versions"
        ordering = ["-version"]
        indexes = [
            models.Index(fields=["function", "version"], name="cfver_fn_ver_idx"),
        ]
        unique_together = (("function", "version"),)

    def __str__(self) -> str:
        return f"{self.function.name} v{self.version}"


###############################################################################
# KVStore
###############################################################################


class KVStore(TenantModel):
    """Per-tenant key-value store, exposed to the sandbox as ``kv.set/get``.

    The only persistent storage the sandbox can write to. Keys are
    tenant-scoped; values are arbitrary text. JSON values should be
    stringified by the sandbox helper before storage.
    """

    key = models.CharField(max_length=255)
    value = models.TextField(blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "custom_functions_kvstore"
        verbose_name = "kv store entry"
        verbose_name_plural = "kv store entries"
        indexes = [
            models.Index(fields=["tenant", "key"], name="cfkv_tenant_key_idx"),
        ]
        unique_together = (("tenant", "key"),)

    def __str__(self) -> str:
        return f"{self.tenant.slug}:{self.key}"


###############################################################################
# HttpAllowlist
###############################################################################


class HttpAllowlist(TenantModel):
    """Per-tenant allowlist of domains the sandbox may call.

    The sandbox's ``http.get/post`` helper checks the URL's host against
    this list (filtered to ``is_active=True``) before issuing the request.
    An empty allowlist means *no outbound HTTP* is permitted.
    """

    domain = models.CharField(
        max_length=255,
        help_text="Bare hostname or suffix match — e.g. 'api.example.com' or 'example.com'.",
    )
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "custom_functions_http_allowlist"
        verbose_name = "HTTP allowlist entry"
        verbose_name_plural = "HTTP allowlist entries"
        indexes = [
            models.Index(fields=["tenant", "is_active"], name="cfallow_active_idx"),
        ]
        unique_together = (("tenant", "domain"),)

    def __str__(self) -> str:
        state = "active" if self.is_active else "paused"
        return f"{self.tenant.slug}:{self.domain} ({state})"


###############################################################################
# HttpCallLog
###############################################################################


class HttpCallLog(TenantModel):
    """Audit log of every outbound HTTP request made from the sandbox.

    Written by the sandbox's ``http`` helper after each call (regardless
    of success). The ``function_execution`` FK is SET_NULL so deleting an
    execution row doesn't cascade onto the call log.
    """

    function_execution = models.ForeignKey(
        CustomFunctionExecution,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="http_calls",
        db_index=True,
    )
    url = models.CharField(max_length=2048)
    method = models.CharField(max_length=8, default="GET")
    status_code = models.IntegerField(null=True, blank=True)
    request_body_size = models.PositiveIntegerField(default=0)
    response_body_size = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "custom_functions_http_call_log"
        verbose_name = "HTTP call log"
        verbose_name_plural = "HTTP call logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "created_at"], name="cfhttp_created_idx"),
        ]

    def __str__(self) -> str:
        code = self.status_code if self.status_code is not None else "—"
        return f"{self.method} {self.url} → {code}"


__all__ = [
    "DATA_BOOLEAN",
    "DATA_JSON",
    "DATA_NUMBER",
    "DATA_RECORD",
    "DATA_STRING",
    "DATA_TYPE_CHOICES",
    "HttpAllowlist",
    "HttpCallLog",
    "KVStore",
    "LANGUAGE_CHOICES",
    "LANGUAGE_JAVASCRIPT",
    "LANGUAGE_PYTHON",
    "LANGUAGE_VISUAL",
    "STATUS_CHOICES",
    "STATUS_COMPLETED",
    "STATUS_FAILED",
    "STATUS_RUNNING",
    "TRIGGER_API",
    "TRIGGER_CHOICES",
    "TRIGGER_MANUAL",
    "TRIGGER_SCHEDULED",
    "TRIGGER_WEBHOOK",
    "TRIGGER_WORKFLOW",
    "VAR_INPUT",
    "VAR_OUTPUT",
    "VAR_TYPE_CHOICES",
    "CustomFunction",
    "CustomFunctionExecution",
    "CustomFunctionVariable",
    "CustomFunctionVersion",
]

"""Service layer for the custom_functions scripting engine.

:class:`CustomFunctionService` is the canonical interface used by:

* :mod:`custom_functions.viewsets` — every ``execute`` / ``test`` /
  ``history`` / ``metrics`` / ``templates`` / ``versions`` / ``approve``
  action delegates here.
* External callers (workflow engine, scheduled actions, webhook endpoint)
  via :meth:`execute` — the only public entry point.

The service is deliberately stateless: callers pass a function id +
input_data and the service resolves everything from the ORM, writes a
:class:`CustomFunctionExecution` row, dispatches to the sandbox, and
updates the function's lifecycle counters.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from django.db import transaction
from django.db.models import Avg
from django.utils import timezone

from .models import (
    CustomFunction,
    CustomFunctionExecution,
    CustomFunctionVariable,
    CustomFunctionVersion,
    HttpAllowlist,
    KVStore,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_RUNNING,
    TRIGGER_MANUAL,
)
from .sandbox import execute_code

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import User

log = logging.getLogger(__name__)


###############################################################################
# Approval gate
###############################################################################

# Triggers that bypass the admin-approval gate (authoring / debugging only).
_UNAPPROVED_ALLOWED_TRIGGERS = frozenset({TRIGGER_MANUAL})


###############################################################################
# CustomFunctionService
###############################################################################


class CustomFunctionService:
    """Stateless service encapsulating the custom-function runtime."""

    # ------------------------------------------------------------------ execute

    def execute(
        self,
        function_id: int,
        input_data: Any = None,
        trigger: str = TRIGGER_MANUAL,
        user: "User | None" = None,
    ) -> CustomFunctionExecution:
        """Run a custom function end-to-end.

        Steps:

        1. Load the function (must be active + tenant-visible).
        2. Enforce the approval gate (production triggers require
           ``is_approved=True``).
        3. Create a :class:`CustomFunctionExecution` row in ``running`` state
           *before* the sandbox runs so a hung execution is visible.
        4. Dispatch to :func:`custom_functions.sandbox.execute_code`.
        5. Persist the result + logs + status; update the function's
           ``execution_count`` / ``error_count`` / ``last_executed_at``.

        No outer transaction wraps the sandbox call — the sandbox may hold
        the GIL for up to 30s and we don't want to keep a DB transaction
        open that long. The final state writes are individually atomic.
        """
        function = CustomFunction.objects.select_related("tenant").get(pk=function_id)
        if not function.is_active:
            raise ValueError(f"Custom function {function.name!r} is not active.")
        if (
            not function.is_approved
            and trigger not in _UNAPPROVED_ALLOWED_TRIGGERS
        ):
            raise PermissionError(
                f"Custom function {function.name!r} requires admin approval before "
                f"it can be triggered by '{trigger}'."
            )
        execution = CustomFunctionExecution.objects.create(
            tenant=function.tenant,
            function=function,
            trigger=trigger,
            input_data=input_data if input_data is not None else {},
            status=STATUS_RUNNING,
            started_at=timezone.now(),
        )
        context: dict[str, Any] = {
            "tenant_id": function.tenant_id,
            "execution_id": execution.pk,
            "function_id": function.pk,
            "user_id": getattr(user, "pk", None),
        }
        result = execute_code(
            code=function.code,
            language=function.language,
            input_data=input_data,
            context=context,
        )
        execution.log_output = result.logs
        execution.execution_time_ms = result.execution_time_ms
        execution.completed_at = timezone.now()
        if result.error:
            execution.status = STATUS_FAILED
            execution.error_message = result.error
            function.error_count = (function.error_count or 0) + 1
        else:
            execution.status = STATUS_COMPLETED
            execution.output_data = self._sanitize_output(result.output)
        function.execution_count = (function.execution_count or 0) + 1
        function.last_executed_at = execution.completed_at
        function.save(
            update_fields=[
                "execution_count",
                "error_count",
                "last_executed_at",
                "updated_at",
            ]
        )
        execution.save(
            update_fields=[
                "log_output",
                "execution_time_ms",
                "completed_at",
                "status",
                "error_message",
                "output_data",
            ]
        )
        return execution

    @staticmethod
    def _sanitize_output(value: Any) -> Any:
        """Best-effort coercion of the sandbox output to a JSON-safe value."""
        if value is None:
            return None
        try:
            import json

            json.dumps(value)
            return value
        except (TypeError, ValueError):
            return str(value)

    # ------------------------------------------------------------------ versions

    def save_version(self, function: CustomFunction, user: "User | None") -> None:
        """Snapshot ``function.code`` as a new :class:`CustomFunctionVersion`.

        Called by the viewset before every update so an admin can roll back
        to any prior version via :meth:`restore_version`.
        """
        next_version = (function.version or 0)
        CustomFunctionVersion.objects.create(
            tenant=function.tenant,
            function=function,
            version=next_version,
            code=function.code,
            created_by=user,
        )
        function.version = next_version + 1
        function.save(update_fields=["version", "updated_at"])

    def restore_version(
        self, function: CustomFunction, version: int, user: "User | None"
    ) -> CustomFunction:
        """Restore ``function.code`` from version ``version``.

        Snapshots the *current* code first (so the rollback itself is
        reversible), then copies the historical code back.
        """
        snapshot = CustomFunctionVersion.objects.filter(
            function=function, version=version
        ).first()
        if snapshot is None:
            raise ValueError(f"Version {version} not found for function {function.pk}.")
        self.save_version(function, user)
        function.code = snapshot.code
        function.save(update_fields=["code", "updated_at"])
        return function

    # ------------------------------------------------------------------ metrics

    def get_metrics(self, function_id: int) -> dict[str, Any]:
        """Return aggregate metrics for a function's execution history."""
        qs = CustomFunctionExecution.objects.filter(function_id=function_id)
        total = qs.count()
        if total == 0:
            return {
                "total_executions": 0,
                "success_rate": 0.0,
                "avg_execution_time": 0.0,
                "last_run": None,
            }
        succeeded = qs.filter(status=STATUS_COMPLETED).count()
        avg_time = (
            qs.aggregate(avg=Avg("execution_time_ms"))["avg"] or 0.0
        )
        last = qs.order_by("-started_at").first()
        return {
            "total_executions": total,
            "success_rate": round(succeeded / total, 4),
            "avg_execution_time": float(avg_time),
            "last_run": last.started_at.isoformat() if last else None,
        }

    # ------------------------------------------------------------------ templates

    def get_templates(self) -> list[dict[str, Any]]:
        """Return the pre-built function templates library.

        Each template is a dict ``{name, description, language,
        trigger_event, code, variables}`` ready to be POSTed to the
        ``create`` endpoint. Templates are pure-data — they never execute
        on read.
        """
        return [
            {
                "name": "Lead Score Calculator",
                "description": (
                    "Compute a 0–100 lead score from title, company size, "
                    "and source. Stores the score in the KV store under "
                    "the lead's id."
                ),
                "language": "python",
                "trigger_event": "workflow",
                "code": _LEAD_SCORE_CODE,
                "variables": [
                    {
                        "name": "lead_id",
                        "var_type": "input",
                        "data_type": "number",
                        "is_required": True,
                        "description": "The Lead id to score.",
                    },
                    {
                        "name": "score",
                        "var_type": "output",
                        "data_type": "number",
                        "is_required": False,
                        "description": "The computed 0–100 score.",
                    },
                ],
            },
            {
                "name": "Sync Deal to External System",
                "description": (
                    "POST a deal payload to an external ERP webhook when "
                    "the deal reaches Closed Won. Requires the ERP host "
                    "to be in the HTTP allowlist."
                ),
                "language": "python",
                "trigger_event": "workflow",
                "code": _SYNC_DEAL_CODE,
                "variables": [
                    {
                        "name": "deal_id",
                        "var_type": "input",
                        "data_type": "number",
                        "is_required": True,
                    },
                    {
                        "name": "synced",
                        "var_type": "output",
                        "data_type": "boolean",
                        "is_required": False,
                    },
                ],
            },
            {
                "name": "Generate Invoice PDF",
                "description": (
                    "Render invoice line items into a JSON descriptor that "
                    "a downstream worker turns into a PDF. Stores the "
                    "descriptor in the KV store for retrieval."
                ),
                "language": "python",
                "trigger_event": "manual",
                "code": _INVOICE_PDF_CODE,
                "variables": [
                    {
                        "name": "deal_id",
                        "var_type": "input",
                        "data_type": "number",
                        "is_required": True,
                    },
                    {
                        "name": "invoice_key",
                        "var_type": "output",
                        "data_type": "string",
                        "is_required": False,
                    },
                ],
            },
            {
                "name": "Send WhatsApp on Stage Change",
                "description": (
                    "Fire a WhatsApp message via an external provider when "
                    "a deal transitions stages. Demonstrates outbound HTTP "
                    "with allowlist + KV counter."
                ),
                "language": "python",
                "trigger_event": "workflow",
                "code": _WHATSAPP_STAGE_CODE,
                "variables": [
                    {
                        "name": "deal_id",
                        "var_type": "input",
                        "data_type": "number",
                        "is_required": True,
                    },
                    {
                        "name": "to",
                        "var_type": "input",
                        "data_type": "string",
                        "is_required": True,
                    },
                ],
            },
            {
                "name": "Auto-merge Duplicate Contacts",
                "description": (
                    "Given a primary contact id + a list of duplicate ids, "
                    "copy non-empty fields from each duplicate into the "
                    "primary and delete the duplicates."
                ),
                "language": "python",
                "trigger_event": "api",
                "code": _MERGE_CONTACTS_CODE,
                "variables": [
                    {
                        "name": "primary_id",
                        "var_type": "input",
                        "data_type": "number",
                        "is_required": True,
                    },
                    {
                        "name": "duplicate_ids",
                        "var_type": "input",
                        "data_type": "json",
                        "is_required": True,
                    },
                    {
                        "name": "merged_count",
                        "var_type": "output",
                        "data_type": "number",
                        "is_required": False,
                    },
                ],
            },
        ]

    # ------------------------------------------------------------------ export / import

    def export_json(self, function: CustomFunction) -> dict[str, Any]:
        """Serialize a function + its declared variables for cross-tenant import."""
        return {
            "name": function.name,
            "description": function.description,
            "language": function.language,
            "trigger_event": function.trigger_event,
            "code": function.code,
            "is_active": function.is_active,
            "version": function.version,
            "variables": [
                {
                    "name": v.name,
                    "var_type": v.var_type,
                    "data_type": v.data_type,
                    "description": v.description,
                    "default_value": v.default_value,
                    "is_required": v.is_required,
                }
                for v in function.variables.all()
            ],
        }

    def import_json(
        self, payload: dict[str, Any], tenant: Any, user: "User | None"
    ) -> CustomFunction:
        """Create a function from a :meth:`export_json` payload."""
        if not isinstance(payload, dict) or "name" not in payload:
            raise ValueError("Payload must be a function JSON object with 'name'.")
        variables = payload.get("variables", []) or []
        with transaction.atomic():
            function = CustomFunction.objects.create(
                tenant=tenant,
                created_by=user,
                name=payload["name"],
                description=payload.get("description", ""),
                language=payload.get("language", "python"),
                trigger_event=payload.get("trigger_event", "manual"),
                code=payload.get("code", ""),
                is_active=bool(payload.get("is_active", False)),
                version=int(payload.get("version", 1)),
            )
            for var in variables:
                CustomFunctionVariable.objects.create(
                    tenant=tenant,
                    function=function,
                    name=var["name"],
                    var_type=var.get("var_type", "input"),
                    data_type=var.get("data_type", "string"),
                    description=var.get("description", ""),
                    default_value=var.get("default_value", ""),
                    is_required=bool(var.get("is_required", False)),
                )
        return function


###############################################################################
# KV helpers (used by the KVStoreViewSet)
###############################################################################


def kv_get(tenant_id: int, key: str) -> str | None:
    entry = KVStore.objects.filter(tenant_id=tenant_id, key=key).first()
    return entry.value if entry else None


def kv_set(tenant_id: int, key: str, value: str) -> KVStore:
    entry, _ = KVStore.objects.update_or_create(
        tenant_id=tenant_id, key=key, defaults={"value": value}
    )
    return entry


def kv_delete(tenant_id: int, key: str) -> bool:
    deleted, _ = KVStore.objects.filter(tenant_id=tenant_id, key=key).delete()
    return deleted > 0


###############################################################################
# Allowlist helpers
###############################################################################


def is_host_allowed(tenant_id: int, host: str) -> bool:
    """Return True if ``host`` matches any active allowlist entry for tenant."""
    host = (host or "").lower()
    if not host:
        return False
    for entry in HttpAllowlist.objects.filter(tenant_id=tenant_id, is_active=True):
        domain = entry.domain.lower()
        if host == domain or host.endswith("." + domain):
            return True
    return False


###############################################################################
# Template source — kept at module bottom for readability
###############################################################################


_LEAD_SCORE_CODE = '''"""Compute a 0-100 lead score from input fields."""
lead = crm.leads.get(input_data["lead_id"])
if lead is None:
    return {"score": 0, "reason": "lead not found"}

score = 0
title = (lead.get("title") or "").lower()
if "vp" in title or "director" in title or "cto" in title:
    score += 30
company_size = lead.get("company_size") or 0
if company_size and company_size > 500:
    score += 25
elif company_size and company_size > 50:
    score += 15
source = (lead.get("lead_source") or "").lower()
if source in ("referral", "partner"):
    score += 20
elif source == "web":
    score += 10
score = min(score, 100)
kv.set(f"lead:{lead['id']}:score", str(score))
log.info(f"Scored lead {lead['id']} -> {score}")
return {"score": score}
'''


_SYNC_DEAL_CODE = '''"""Sync a deal to an external ERP webhook."""
deal = crm.deals.get(input_data["deal_id"])
if deal is None:
    return {"synced": False, "reason": "deal not found"}
payload = {
    "external_id": deal["id"],
    "name": deal.get("name"),
    "amount": deal.get("amount"),
    "stage": deal.get("stage"),
    "closed_at": deal.get("closed_at"),
}
resp = http.post(
    "https://erp.example.com/api/deals",
    body=payload,
    headers={"X-Source": "crm"},
)
if resp.get("status") == 200:
    kv.set(f"deal:{deal['id']}:erp_synced", "1")
    return {"synced": True}
log.error(f"ERP sync failed: {resp.get('error') or resp.get('status')}")
return {"synced": False, "error": resp.get("error") or resp.get("status")}
'''


_INVOICE_PDF_CODE = '''"""Build an invoice descriptor and stash it in the KV store."""
deal = crm.deals.get(input_data["deal_id"])
if deal is None:
    return {"invoice_key": None, "reason": "deal not found"}
lines = input_data.get("line_items") or [
    {"description": "Services", "quantity": 1, "unit_price": deal.get("amount", 0)}
]
subtotal = sum(line.get("quantity", 1) * line.get("unit_price", 0) for line in lines)
tax = round(subtotal * 0.1, 2)
total = round(subtotal + tax, 2)
descriptor = {
    "deal_id": deal["id"],
    "customer": deal.get("name"),
    "lines": lines,
    "subtotal": subtotal,
    "tax": tax,
    "total": total,
}
import json
key = f"invoice:{deal['id']}"
kv.set(key, json.dumps(descriptor))
log.info(f"Wrote invoice descriptor to {key}")
return {"invoice_key": key, "total": total}
'''


_WHATSAPP_STAGE_CODE = '''"""Send a WhatsApp notification on stage change."""
deal = crm.deals.get(input_data["deal_id"])
if deal is None:
    return {"sent": False, "reason": "deal not found"}
to = input_data.get("to") or ""
if not to:
    return {"sent": False, "reason": "missing 'to'"}
message = (
    f"Hi! Your deal '{deal.get('name')}' just moved to the "
    f"'{deal.get('stage')}' stage."
)
resp = http.post(
    "https://api.whatsapp.example.com/send",
    body={"to": to, "message": message},
)
counter_key = f"deal:{deal['id']}:wa_sent"
current = kv.get(counter_key) or "0"
kv.set(counter_key, str(int(current) + 1))
return {"sent": resp.get("status") == 200, "status": resp.get("status")}
'''


_MERGE_CONTACTS_CODE = '''"""Merge duplicate contacts into a primary contact."""
primary_id = input_data["primary_id"]
duplicate_ids = input_data.get("duplicate_ids") or []
primary = crm.contacts.get(primary_id)
if primary is None:
    return {"merged_count": 0, "reason": "primary not found"}

merged = 0
for dup_id in duplicate_ids:
    dup = crm.contacts.get(dup_id)
    if dup is None:
        continue
    updates = {}
    for field in ("email", "phone", "first_name", "last_name", "title"):
        if not primary.get(field) and dup.get(field):
            updates[field] = dup[field]
    if updates:
        crm.contacts.update(primary_id, **updates)
        primary.update(updates)
    crm.contacts.delete(dup_id)
    merged += 1
log.info(f"Merged {merged} duplicates into contact {primary_id}")
return {"merged_count": merged}
'''


__all__ = [
    "CustomFunctionService",
    "is_host_allowed",
    "kv_delete",
    "kv_get",
    "kv_set",
]

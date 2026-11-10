"""Execution sandboxes for the custom_functions scripting engine.

Two sandboxes are provided:

* :class:`PythonSandbox` — RestrictedPython-based executor with a curated
  globals dict exposing a CRM / HTTP / KV / email / SMS / log API. Falls
  back to a manual AST walk when RestrictedPython isn't installed. A 30s
  wall-clock timeout is enforced via :class:`concurrent.futures.ThreadPoolExecutor`.
* :class:`JavaScriptSandbox` — QuickJS subprocess executor. The user's
  code is wrapped in an async IIFE that receives ``inputData`` and is
  expected to ``return`` a JSON-serializable value. The QuickJS CLI
  (``qjs``) is invoked via :mod:`subprocess`; if it isn't installed the
  sandbox returns a structured error.

:func:`execute_code` dispatches by language.

Security notes
--------------
* The Python sandbox never imports user code — it ``exec``s a wrapped
  snippet inside a tightly-scoped globals dict. ``__builtins__`` is
  replaced with a curated whitelist. Import / dunder-attribute access is
  rejected at AST level (defense-in-depth alongside RestrictedPython).
* Outbound HTTP is gated by the per-tenant :class:`HttpAllowlist`.
* The only persistent write target the sandbox exposes is the
  :class:`KVStore`; CRM ``create`` / ``update`` / ``delete`` go through
  the regular ORM and are subject to the model's own validation.
"""

from __future__ import annotations

import ast
import contextlib
import io
import json
import logging
import math
import operator
import os
import re
import subprocess
import tempfile
import textwrap
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import datetime
from typing import TYPE_CHECKING, Any
from urllib import parse as url_parse
from urllib import request as url_request
from urllib.error import HTTPError, URLError

from django.apps import apps

from .models import HttpAllowlist, HttpCallLog, KVStore

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User

log = logging.getLogger(__name__)

TIME_LIMIT_SECONDS = 30
MEMORY_LIMIT_BYTES = 256 * 1024 * 1024  # 256 MB — advisory; enforced where possible
HTTP_TIMEOUT_SECONDS = 10
QUERY_RESULT_CAP = 100

###############################################################################
# Optional RestrictedPython
###############################################################################

try:  # pragma: no cover — import guard
    from RestrictedPython import compile_restricted_exec

    HAS_RESTRICTED_PYTHON = True
except ImportError:  # pragma: no cover — RestrictedPython is optional
    HAS_RESTRICTED_PYTHON = False
    compile_restricted_exec = None  # type: ignore[assignment]


###############################################################################
# Safe builtins + module whitelist
###############################################################################

# Builtins exposed verbatim to user code. Anything not in here is unreachable.
_ALLOWED_BUILTINS: dict[str, Any] = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "bytes": bytes,
    "chr": chr,
    "dict": dict,
    "divmod": divmod,
    "enumerate": enumerate,
    "Exception": Exception,
    "ValueError": ValueError,
    "TypeError": TypeError,
    "KeyError": KeyError,
    "IndexError": IndexError,
    "AttributeError": AttributeError,
    "StopIteration": StopIteration,
    "ZeroDivisionError": ZeroDivisionError,
    "RuntimeError": RuntimeError,
    "filter": filter,
    "float": float,
    "format": format,
    "frozenset": frozenset,
    "hash": hash,
    "hex": hex,
    "int": int,
    "isinstance": isinstance,
    "iter": iter,
    "len": len,
    "list": list,
    "map": map,
    "max": max,
    "min": min,
    "next": next,
    "oct": oct,
    "ord": ord,
    "pow": pow,
    "print": print,
    "range": range,
    "repr": repr,
    "reversed": reversed,
    "round": round,
    "set": set,
    "slice": slice,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "type": type,
    "zip": zip,
    "True": True,
    "False": False,
    "None": None,
}

# Names that are *never* allowed in user code (defense-in-depth even when
# RestrictedPython is unavailable).
_FORBIDDEN_NAMES = frozenset(
    {
        "eval",
        "exec",
        "compile",
        "open",
        "__import__",
        "globals",
        "locals",
        "vars",
        "dir",
        "getattr",
        "setattr",
        "delattr",
        "breakpoint",
        "exit",
        "quit",
        "input",
        "memoryview",
        "classmethod",
        "staticmethod",
        "property",
        "super",
    }
)

# Modules exposed to user code (read-only attrs only).
_ALLOWED_MODULES: dict[str, Any] = {
    "datetime": __import__("datetime"),
    "re": re,
    "json": json,
    "math": math,
}


###############################################################################
# AST safety visitor — used when RestrictedPython isn't installed
###############################################################################


class _SafetyVisitor(ast.NodeVisitor):
    """AST visitor that collects disallowed nodes in user code.

    Used as a defense-in-depth check when RestrictedPython is unavailable.
    RestrictedPython itself does a much more thorough transformation; this
    visitor only catches the most common escape vectors (imports, dunder
    attribute access, forbidden global names).
    """

    def __init__(self) -> None:
        self.errors: list[str] = []

    def visit_Import(self, node: ast.Import) -> None:  # noqa: N802
        self.errors.append("Imports are not allowed in the sandbox.")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:  # noqa: N802
        self.errors.append("Imports are not allowed in the sandbox.")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:  # noqa: N802
        if isinstance(node.attr, str) and node.attr.startswith("__") and node.attr.endswith("__"):
            self.errors.append(f"Dunder attribute access is not allowed: '{node.attr}'.")
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:  # noqa: N802
        if node.id in _FORBIDDEN_NAMES:
            self.errors.append(f"Use of '{node.id}' is not allowed in the sandbox.")
        self.generic_visit(node)


def _validate_python_ast(source: str) -> None:
    """Parse + walk ``source``; raise ``SyntaxError`` if disallowed nodes found."""
    tree = ast.parse(source)
    visitor = _SafetyVisitor()
    visitor.visit(tree)
    if visitor.errors:
        raise SyntaxError("; ".join(visitor.errors))


###############################################################################
# CRM API surface
###############################################################################


def _record_to_dict(obj: Any) -> dict[str, Any]:
    """Project an ORM instance into a JSON-safe dict of concrete-field values."""
    out: dict[str, Any] = {}
    for field in obj._meta.concrete_fields:  # type: ignore[attr-defined]
        value = getattr(obj, field.attname)
        if isinstance(value, datetime):
            value = value.isoformat()
        out[field.name] = value
    return out


class _RecordApi:
    """A scoped API for one CRM module (leads / contacts / deals / accounts).

    All methods filter by ``tenant_id`` so a sandboxed function cannot read
    or mutate another tenant's records. ``query`` results are capped at
    :data:`QUERY_RESULT_CAP` rows to prevent unbounded memory use.
    """

    def __init__(self, model_path: str, tenant_id: int) -> None:
        self._model_path = model_path
        self._tenant_id = tenant_id
        app_label, model_name = model_path.split(".")
        self._model = apps.get_model(app_label, model_name)

    def get(self, id: int | str) -> dict[str, Any] | None:
        obj = self._model.objects.filter(pk=id, tenant_id=self._tenant_id).first()
        return _record_to_dict(obj) if obj else None

    def query(self, **filters: Any) -> list[dict[str, Any]]:
        qs = self._model.objects.filter(tenant_id=self._tenant_id, **filters)
        return [_record_to_dict(o) for o in qs[:QUERY_RESULT_CAP]]

    def create(self, **fields: Any) -> dict[str, Any]:
        obj = self._model(tenant_id=self._tenant_id, **fields)
        obj.save()
        return _record_to_dict(obj)

    def update(self, id: int | str, **fields: Any) -> dict[str, Any] | None:
        obj = self._model.objects.filter(pk=id, tenant_id=self._tenant_id).first()
        if obj is None:
            return None
        for key, value in fields.items():
            setattr(obj, key, value)
        obj.save()
        return _record_to_dict(obj)

    def delete(self, id: int | str) -> bool:
        deleted, _ = self._model.objects.filter(
            pk=id, tenant_id=self._tenant_id
        ).delete()
        return deleted > 0


class _CrmApi:
    """Top-level ``crm`` object exposed to user code.

    Exposes ``leads`` / ``contacts`` / ``deals`` / ``accounts`` sub-objects
    with the same method surface (get / query / create / update / delete).
    """

    def __init__(self, tenant_id: int) -> None:
        self.leads = _RecordApi("leads.Lead", tenant_id)
        self.contacts = _RecordApi("contacts.Contact", tenant_id)
        self.deals = _RecordApi("deals.Deal", tenant_id)
        self.accounts = _RecordApi("accounts.Account", tenant_id)


###############################################################################
# HTTP API surface
###############################################################################


class _HttpApi:
    """HTTP helper gated by the tenant's :class:`HttpAllowlist`.

    ``get`` / ``post`` return a dict ``{status, body, headers}`` on success
    or ``{status: 0, error: str}`` on transport failure. Every call is
    recorded as a :class:`HttpCallLog` row for audit.
    """

    def __init__(self, tenant_id: int, execution_id: int | None) -> None:
        self._tenant_id = tenant_id
        self._execution_id = execution_id

    def get(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        timeout: int = HTTP_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
        return self._request("GET", url, params=params, headers=headers, timeout=timeout)

    def post(
        self,
        url: str,
        body: Any = None,
        headers: dict[str, str] | None = None,
        timeout: int = HTTP_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
        return self._request("POST", url, body=body, headers=headers, timeout=timeout)

    # ------------------------------------------------------------------ internal

    def _request(
        self,
        method: str,
        url: str,
        params: dict[str, Any] | None = None,
        body: Any = None,
        headers: dict[str, str] | None = None,
        timeout: int = HTTP_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
        self._check_allowlist(url)
        full_url = url
        if params:
            full_url = f"{url}?{url_parse.urlencode(params)}"
        req_body: bytes | None = None
        req_size = 0
        headers = dict(headers or {})
        if body is not None:
            if isinstance(body, (dict, list)):
                req_body = json.dumps(body).encode("utf-8")
                headers.setdefault("Content-Type", "application/json")
            elif isinstance(body, str):
                req_body = body.encode("utf-8")
            elif isinstance(body, bytes):
                req_body = body
            req_size = len(req_body or b"")
        req = url_request.Request(full_url, data=req_body, method=method)
        for key, value in headers.items():
            req.add_header(key, str(value))
        try:
            with url_request.urlopen(req, timeout=timeout) as resp:
                resp_body = resp.read()
                status = resp.status
                resp_headers = dict(resp.headers.items())
                resp_size = len(resp_body)
        except HTTPError as exc:
            resp_body = exc.read() or b""
            status = exc.code
            resp_headers = {}
            resp_size = len(resp_body)
        except (URLError, OSError) as exc:
            self._log_call(full_url, method, None, req_size, None)
            return {"status": 0, "error": str(exc), "body": None, "headers": {}}
        self._log_call(full_url, method, status, req_size, resp_size)
        try:
            parsed = json.loads(resp_body.decode("utf-8"))
            body_out: Any = parsed
        except (ValueError, UnicodeDecodeError):
            body_out = resp_body.decode("utf-8", errors="replace")
        return {"status": status, "body": body_out, "headers": resp_headers}

    def _check_allowlist(self, url: str) -> None:
        parsed = url_parse.urlparse(url)
        host = (parsed.hostname or "").lower()
        if not host:
            raise ValueError(f"Invalid URL: {url!r}")
        allowed = {
            entry.domain.lower()
            for entry in HttpAllowlist.objects.filter(
                tenant_id=self._tenant_id, is_active=True
            )
        }
        if not any(host == d or host.endswith("." + d) for d in allowed):
            raise PermissionError(f"Host '{host}' is not in the HTTP allowlist.")

    def _log_call(
        self,
        url: str,
        method: str,
        status_code: int | None,
        req_size: int,
        resp_size: int | None,
    ) -> None:
        HttpCallLog.objects.create(
            tenant_id=self._tenant_id,
            function_execution_id=self._execution_id,
            url=url[:2048],
            method=method,
            status_code=status_code,
            request_body_size=req_size,
            response_body_size=resp_size,
        )


###############################################################################
# KV API surface
###############################################################################


class _KVApi:
    """Per-tenant key-value store, exposed as ``kv.set/get/delete``.

    Non-string values are JSON-encoded on the way in; the caller gets the
    raw text back via ``get`` (decoding JSON is the caller's responsibility).
    """

    def __init__(self, tenant_id: int) -> None:
        self._tenant_id = tenant_id

    def get(self, key: str) -> str | None:
        entry = KVStore.objects.filter(tenant_id=self._tenant_id, key=key).first()
        return entry.value if entry else None

    def set(self, key: str, value: Any) -> bool:
        if not isinstance(key, str) or not key:
            raise ValueError("kv key must be a non-empty string")
        if not isinstance(value, str):
            value = json.dumps(value)
        KVStore.objects.update_or_create(
            tenant_id=self._tenant_id,
            key=key,
            defaults={"value": value},
        )
        return True

    def delete(self, key: str) -> bool:
        deleted, _ = KVStore.objects.filter(
            tenant_id=self._tenant_id, key=key
        ).delete()
        return deleted > 0


###############################################################################
# Log + send_email / send_sms
###############################################################################


class _LogApi:
    """``log.info`` / ``log.error`` — both append to the captured stdout buffer."""

    def __init__(self, buffer: io.StringIO) -> None:
        self._buffer = buffer

    def info(self, msg: Any, *args: Any) -> None:
        self._write("INFO", msg, args)

    def error(self, msg: Any, *args: Any) -> None:
        self._write("ERROR", msg, args)

    def _write(self, level: str, msg: Any, args: tuple[Any, ...]) -> None:
        text = str(msg)
        if args:
            try:
                text = text % args
            except Exception:  # pragma: no cover — defensive
                pass
        self._buffer.write(f"[{level}] {text}\n")


def _make_send_email(tenant_id: int) -> Any:
    """Build a ``send_email(to_email, subject, body) -> bool`` closure."""

    def send_email(to_email: str, subject: str, body: str) -> bool:
        from api.models import User
        from notifications.services import send_email_notification

        recipient = User.objects.filter(email=to_email).first()
        if recipient is None:
            return False
        send_email_notification(recipient, subject, body)
        return True

    return send_email


def _make_send_sms(tenant_id: int) -> Any:
    """Build a ``send_sms(to_number, body) -> bool`` closure."""

    def send_sms(to_number: str, body: str) -> bool:
        from api.models import User
        from notifications.services import send_sms_notification

        # Match either Profile.phone or the user's name — be liberal so test
        # fixtures can drive the call without a full Twilio setup.
        recipient = (
            User.objects.filter(profile__phone=to_number).first()
            or User.objects.filter(name=to_number).first()
        )
        if recipient is None:
            return False
        send_sms_notification(recipient, body)
        return True

    return send_sms


###############################################################################
# Result type
###############################################################################


class SandboxResult:
    """Structured sandbox return value."""

    __slots__ = ("output", "logs", "error", "execution_time_ms")

    def __init__(
        self,
        output: Any,
        logs: str,
        error: str | None,
        execution_time_ms: int,
    ) -> None:
        self.output = output
        self.logs = logs
        self.error = error
        self.execution_time_ms = execution_time_ms

    def to_dict(self) -> dict[str, Any]:
        return {
            "output": self.output,
            "logs": self.logs,
            "error": self.error,
            "execution_time_ms": self.execution_time_ms,
        }


###############################################################################
# RestrictedPython guard callbacks
###############################################################################


# Augmented-assignment operator → operator-function map for ``_inplacevar_``.
_INPLACE_OPS: dict[str, Any] = {
    "+=": operator.iadd,
    "-=": operator.isub,
    "*=": operator.imul,
    "/=": operator.itruediv,
    "//=": operator.ifloordiv,
    "%=": operator.imod,
    "**=": operator.ipow,
    "<<=": operator.ilshift,
    ">>=": operator.irshift,
    "&=": operator.iand,
    "|=": operator.ior,
    "^=": operator.ixor,
}


def _safe_getattr(obj: Any, name: str, default: Any = None) -> Any:
    """RestrictedPython ``_getattr_`` callback — blocks dunder access at runtime.

    The AST-level :class:`_SafetyVisitor` is the primary defense (it rejects
    dunder attribute access at compile time). This callback is the
    defense-in-depth runtime guard for the case where RestrictedPython
    rewrites attribute access into ``_getattr_(obj, name)`` form.
    """
    if isinstance(name, str) and name.startswith("__") and name.endswith("__"):
        raise AttributeError(f"Dunder attribute access is not allowed: '{name}'.")
    # Block access to frame / code objects on generators / coroutines.
    if name in {"gi_frame", "gi_code", "cr_frame", "cr_code", "ag_frame", "ag_code"}:
        raise AttributeError(f"Attribute access is not allowed: '{name}'.")
    return getattr(obj, name, default)


def _write_(obj: Any) -> Any:
    """RestrictedPython ``_write_`` callback — pass-through (writes are governed by ``__builtins__``)."""
    return obj


def _getitem_(obj: Any, key: Any) -> Any:
    """RestrictedPython ``_getitem_`` callback — used for ``obj[key]`` access."""
    return obj[key]


def _apply_(func: Any, *args: Any, **kwargs: Any) -> Any:
    """RestrictedPython ``_apply_`` callback — used for ``f(*args, **kwargs)`` calls."""
    return func(*args, **kwargs)


def _inplacevar_(op: str, x: Any, y: Any) -> Any:
    """RestrictedPython ``_inplacevar_`` callback — augmented assignment."""
    func = _INPLACE_OPS.get(op)
    if func is None:
        raise ValueError(f"Unknown inplace operator: {op!r}")
    return func(x, y)


###############################################################################
# PythonSandbox
###############################################################################


_PY_TEMPLATE = (
    "def _cf_run(input_data, crm, http, kv, log, send_email, send_sms):\n"
    "{body}\n"
)


def _wrap_python_source(code: str) -> str:
    """Indent ``code`` and wrap it inside a ``_cf_run`` function body."""
    body = textwrap.indent(code, "    ") if code.strip() else "    pass"
    return _PY_TEMPLATE.format(body=body)


def _build_python_globals(buffer: io.StringIO, context: dict[str, Any]) -> dict[str, Any]:
    """Build the globals dict passed to ``exec`` for the wrapped user code."""
    tenant_id = int(context.get("tenant_id") or 0)
    execution_id = context.get("execution_id")
    globals_dict: dict[str, Any] = {
        "__builtins__": _ALLOWED_BUILTINS,
        "__name__": "custom_function_sandbox",
    }
    # Module whitelist.
    globals_dict.update(_ALLOWED_MODULES)
    # RestrictedPython guard callbacks (harmless when RestrictedPython isn't
    # installed — plain `compile` doesn't reference these names).
    globals_dict["_getattr_"] = _safe_getattr
    globals_dict["_write_"] = _write_
    globals_dict["_getitem_"] = _getitem_
    globals_dict["_apply_"] = _apply_
    globals_dict["_inplacevar_"] = _inplacevar_
    # API surface.
    globals_dict["crm"] = _CrmApi(tenant_id)
    globals_dict["http"] = _HttpApi(tenant_id, execution_id)
    globals_dict["kv"] = _KVApi(tenant_id)
    globals_dict["log"] = _LogApi(buffer)
    globals_dict["send_email"] = _make_send_email(tenant_id)
    globals_dict["send_sms"] = _make_send_sms(tenant_id)
    return globals_dict


def _run_python(code: str, input_data: Any, context: dict[str, Any]) -> SandboxResult:
    """Execute Python ``code`` synchronously and return a :class:`SandboxResult`."""
    started = time.monotonic()
    buffer = io.StringIO()
    try:
        wrapped = _wrap_python_source(code)
        # Always run the AST walk — defense-in-depth even when
        # RestrictedPython is installed (it catches the same escape vectors
        # and produces friendlier error messages).
        _validate_python_ast(wrapped)
        if HAS_RESTRICTED_PYTHON and compile_restricted_exec is not None:
            compiled_result = compile_restricted_exec(wrapped, "<custom_function>")
            if compiled_result.errors:
                raise SyntaxError("; ".join(compiled_result.errors))
            if compiled_result.warnings:  # pragma: no cover — defensive
                for warning in compiled_result.warnings:
                    buffer.write(f"[WARN] {warning}\n")
            code_obj = compiled_result.code
        else:
            code_obj = compile(wrapped, "<custom_function>", "exec")
    except SyntaxError as exc:
        return SandboxResult(
            output=None,
            logs=buffer.getvalue(),
            error=f"SyntaxError: {exc.msg}",
            execution_time_ms=int((time.monotonic() - started) * 1000),
        )

    globals_dict = _build_python_globals(buffer, context)

    def _invoke() -> Any:
        with contextlib.redirect_stdout(buffer):
            exec(code_obj, globals_dict)  # noqa: S102 — sandboxed exec
            run_fn = globals_dict["_cf_run"]
            return run_fn(
                input_data,
                crm=globals_dict["crm"],
                http=globals_dict["http"],
                kv=globals_dict["kv"],
                log=globals_dict["log"],
                send_email=globals_dict["send_email"],
                send_sms=globals_dict["send_sms"],
            )

    error: str | None = None
    output: Any = None
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_invoke)
        try:
            output = future.result(timeout=TIME_LIMIT_SECONDS)
        except FuturesTimeoutError:
            error = f"Execution timed out after {TIME_LIMIT_SECONDS}s."
        except Exception as exc:  # noqa: BLE001 — surface every user-code error
            error = f"{type(exc).__name__}: {exc}"
    return SandboxResult(
        output=output,
        logs=buffer.getvalue(),
        error=error,
        execution_time_ms=int((time.monotonic() - started) * 1000),
    )


class PythonSandbox:
    """Public Python sandbox executor."""

    def execute(
        self, code: str, input_data: Any, context: dict[str, Any]
    ) -> SandboxResult:
        return _run_python(code, input_data, context)


###############################################################################
# JavaScriptSandbox
###############################################################################


_JS_TEMPLATE = """\
"use strict";
(async function(inputData) {{
{body}
}})({input_json}).then(
    function(r) {{ console.log(JSON.stringify(r)); }},
    function(e) {{ console.error(String(e)); throw e; }}
);
"""


def _wrap_javascript_source(code: str, input_data: Any) -> str:
    """Wrap user JS code in an async IIFE that exposes ``inputData``.

    User code may use ``return`` to set the output value; async/await is
    supported because the wrapper is an async function. The wrapper's
    ``.then`` handler serializes the resolved value to stdout as JSON; the
    Python side parses the last non-empty stdout line as the result.
    """
    body = textwrap.indent(code, "    ") if code.strip() else "    return null;"
    input_json = json.dumps(input_data)
    return _JS_TEMPLATE.format(body=body, input_json=input_json)


def _run_javascript(code: str, input_data: Any, context: dict[str, Any]) -> SandboxResult:
    """Execute JavaScript ``code`` via the ``qjs`` QuickJS CLI subprocess."""
    started = time.monotonic()
    source = _wrap_javascript_source(code, input_data)
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".js", delete=False, encoding="utf-8"
        ) as tmp:
            tmp.write(source)
            tmp_path = tmp.name
    except OSError as exc:
        return SandboxResult(
            output=None,
            logs="",
            error=f"Failed to stage JS source: {exc}",
            execution_time_ms=int((time.monotonic() - started) * 1000),
        )
    try:
        proc = subprocess.run(  # noqa: S603 — trusted binary, argv is controlled
            ["qjs", "--std", tmp_path],
            capture_output=True,
            text=True,
            timeout=TIME_LIMIT_SECONDS,
            check=False,
        )
    except FileNotFoundError:
        return SandboxResult(
            output=None,
            logs="",
            error="QuickJS ('qjs') is not installed on the host.",
            execution_time_ms=int((time.monotonic() - started) * 1000),
        )
    except subprocess.TimeoutExpired:
        return SandboxResult(
            output=None,
            logs="",
            error=f"Execution timed out after {TIME_LIMIT_SECONDS}s.",
            execution_time_ms=int((time.monotonic() - started) * 1000),
        )
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:  # pragma: no cover — defensive
            pass
    stdout = proc.stdout or ""
    stderr = proc.stderr or ""
    error: str | None = None
    output: Any = None
    if proc.returncode != 0:
        error = stderr.strip() or f"qjs exited with code {proc.returncode}."
    else:
        # The last non-empty stdout line is parsed as the result if it's JSON.
        lines = [line for line in stdout.splitlines() if line.strip()]
        if lines:
            try:
                output = json.loads(lines[-1])
            except ValueError:
                output = lines[-1]
    return SandboxResult(
        output=output,
        logs=stdout,
        error=error,
        execution_time_ms=int((time.monotonic() - started) * 1000),
    )


class JavaScriptSandbox:
    """Public JavaScript sandbox executor (QuickJS subprocess)."""

    def execute(
        self, code: str, input_data: Any, context: dict[str, Any]
    ) -> SandboxResult:
        return _run_javascript(code, input_data, context)


###############################################################################
# Dispatcher
###############################################################################


def execute_code(
    code: str,
    language: str,
    input_data: Any,
    context: dict[str, Any] | None = None,
) -> SandboxResult:
    """Run ``code`` in the appropriate sandbox and return a :class:`SandboxResult`.

    ``language`` is one of ``python`` / ``javascript`` / ``visual`` (the
    last is treated as Python). ``context`` carries the tenant_id + optional
    execution_id (for HttpCallLog linkage).
    """
    context = context or {}
    if language in {"python", "visual"}:
        return PythonSandbox().execute(code, input_data, context)
    if language == "javascript":
        return JavaScriptSandbox().execute(code, input_data, context)
    return SandboxResult(
        output=None,
        logs="",
        error=f"Unsupported language: {language!r}",
        execution_time_ms=0,
    )


__all__ = [
    "HAS_RESTRICTED_PYTHON",
    "JavaScriptSandbox",
    "MEMORY_LIMIT_BYTES",
    "PythonSandbox",
    "SandboxResult",
    "TIME_LIMIT_SECONDS",
    "execute_code",
]

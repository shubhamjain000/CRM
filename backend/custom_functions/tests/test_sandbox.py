"""Sandbox tests for the custom_functions app.

Covers :mod:`custom_functions.sandbox`:
* :func:`execute_code` — Python happy path + import rejection + JS dispatch.
* :class:`PythonSandbox` — log capture + KV store round-trip.
* :class:`JavaScriptSandbox` — wrapper generation + missing-binary fallback.
"""

from __future__ import annotations

import pytest

from custom_functions.factories import HttpAllowlistFactory
from custom_functions.sandbox import (
    JavaScriptSandbox,
    PythonSandbox,
    SandboxResult,
    _wrap_javascript_source,
    execute_code,
)


pytestmark = pytest.mark.django_db


###############################################################################
# PythonSandbox
###############################################################################


def test_python_sandbox_returns_input_transformation(active_tenant, user):  # type: ignore[no-untyped-def]
    code = "return {'out': input_data['x'] + 1}"
    result = execute_code(
        code=code,
        language="python",
        input_data={"x": 41},
        context={"tenant_id": active_tenant.pk, "user_id": user.pk},
    )
    assert isinstance(result, SandboxResult)
    assert result.error is None
    assert result.output == {"out": 42}
    assert result.execution_time_ms >= 0


def test_python_sandbox_rejects_imports(active_tenant, user):  # type: ignore[no-untyped-def]
    code = "import os\nreturn os.getcwd()"
    result = PythonSandbox().execute(
        code, input_data={}, context={"tenant_id": active_tenant.pk}
    )
    assert result.error is not None
    assert "Import" in result.error or "import" in result.error.lower()


def test_python_sandbox_captures_log_and_kv_round_trip(active_tenant, user):  # type: ignore[no-untyped-def]
    code = (
        "log.info('hello from fn')\n"
        "kv.set('greeting', 'hi')\n"
        "return {'stored': kv.get('greeting')}\n"
    )
    result = PythonSandbox().execute(
        code, input_data={}, context={"tenant_id": active_tenant.pk}
    )
    assert result.error is None
    assert result.output == {"stored": "hi"}
    assert "[INFO] hello from fn" in result.logs
    # KV persisted to the database.
    from custom_functions.models import KVStore

    entry = KVStore.objects.filter(
        tenant=active_tenant, key="greeting"
    ).first()
    assert entry is not None
    assert entry.value == "hi"


def test_python_sandbox_http_blocked_without_allowlist(active_tenant, user):  # type: ignore[no-untyped-def]
    code = "return http.get('https://evil.example.com/steal').get('status', 0)"
    result = PythonSandbox().execute(
        code, input_data={}, context={"tenant_id": active_tenant.pk}
    )
    assert result.error is not None
    assert "allowlist" in result.error.lower()


def test_python_sandbox_http_allowed_with_allowlist_entry(active_tenant, user, monkeypatch):  # type: ignore[no-untyped-def]
    HttpAllowlistFactory(tenant=active_tenant, domain="api.example.com")
    # Stub urllib.request.urlopen so the test never makes a real network call.
    from unittest.mock import MagicMock

    from custom_functions import sandbox as sb_mod

    fake_resp = MagicMock()
    fake_resp.status = 200
    fake_resp.read.return_value = b'{"ok": true}'
    fake_resp.headers.items.return_value = []
    fake_resp.__enter__.return_value = fake_resp
    fake_resp.__exit__.return_value = None

    monkeypatch.setattr(sb_mod.url_request, "urlopen", lambda req, timeout=None: fake_resp)
    code = "return http.get('https://api.example.com/v1/ping')"
    result = PythonSandbox().execute(
        code, input_data={}, context={"tenant_id": active_tenant.pk}
    )
    assert result.error is None
    assert result.output["status"] == 200
    assert result.output["body"] == {"ok": True}


###############################################################################
# JavaScriptSandbox
###############################################################################


def test_js_wrapper_includes_input_data_and_iife():  # type: ignore[no-untyped-def]
    wrapped = _wrap_javascript_source("return inputData.x * 2;", {"x": 21})
    assert "async function(inputData)" in wrapped
    assert '"x": 21' in wrapped
    assert "return inputData.x * 2" in wrapped


def test_js_sandbox_returns_error_when_quickjs_missing(active_tenant, user, monkeypatch):  # type: ignore[no-untyped-def]
    # Stub subprocess.run to raise FileNotFoundError (qjs not installed).
    from custom_functions import sandbox as sb_mod

    def _raise_fnf(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise FileNotFoundError("qjs")

    monkeypatch.setattr(sb_mod.subprocess, "run", _raise_fnf)
    result = JavaScriptSandbox().execute(
        "return 1 + 1;", input_data={}, context={"tenant_id": active_tenant.pk}
    )
    assert isinstance(result, SandboxResult)
    assert result.error is not None
    assert "qjs" in result.error.lower() or "QuickJS" in result.error


###############################################################################
# execute_code dispatcher
###############################################################################


def test_execute_code_unsupported_language_returns_error(active_tenant, user):  # type: ignore[no-untyped-def]
    result = execute_code(
        code="x", language="brainfuck", input_data={}, context={}
    )
    assert result.error is not None
    assert "Unsupported language" in result.error

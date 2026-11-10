"""Tenant resolution middleware.

Resolution order
----------------
1. **Subdomain** of ``Host`` (e.g. ``acme.app.foundation.dev`` → ``acme``).
2. **Session** ``tenant_id`` (set by ``OrganizationSwitchView``).
3. **``X-Organization`` header** — slug or id, used by API clients.
4. **Custom domain** — exact match against ``Organization.custom_domain``.
5. Fallback: ``None`` (no tenant).

When a subdomain resolves to an inactive organization the middleware returns
404. The active tenant is stashed on ``request.tenant`` and bound to the
thread-local via :func:`api.managers.tenant_context`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable

from django.http import JsonResponse, HttpResponseNotFound

from .managers import set_current_tenant, tenant_context
from .models import Organization, TenantMembership

if TYPE_CHECKING:  # pragma: no cover
    from django.http import HttpRequest, HttpResponse


# Hosts that should *never* be treated as tenant subdomains (apex domain,
# ``www``, ``api``, dev hosts).
NON_TENANT_HOST_PREFIXES = {"www", "api", "admin", "localhost", "127", ""}


class TenantMiddleware:
    """Resolve and bind the current tenant on every request."""

    def __init__(self, get_response: Callable[["HttpRequest"], "HttpResponse"]) -> None:
        self.get_response = get_response

    def __call__(self, request: "HttpRequest") -> "HttpResponse":
        tenant = self._resolve_tenant(request)
        if tenant is None and self._requested_via_subdomain(request):
            # An explicit subdomain that did not resolve (or resolved to an
            # inactive org) is a 404, not a silent fallback to global context.
            return HttpResponseNotFound("Organization not found.")
        request.tenant = tenant  # type: ignore[attr-defined]
        request.tenant_membership = self._resolve_membership(request, tenant)  # type: ignore[attr-defined]
        # Bind the thread-local so any ORM call inside the request honors it.
        set_current_tenant(tenant)
        with tenant_context(tenant):
            response = self.get_response(request)
        # Defensive: clear the thread-local in case a pooled worker thread is
        # reused for a system-level task next.
        set_current_tenant(None)
        return response

    # ------------------------------------------------------------------ resolve

    def _resolve_tenant(self, request: "HttpRequest") -> "Organization | None":
        host = request.get_host().split(":")[0].lower()
        subdomain = self._extract_subdomain(host)
        if subdomain:
            org = Organization.objects.filter(subdomain=subdomain, is_active=True).first()
            if org is not None:
                return org
            if Organization.objects.filter(subdomain=subdomain).exists():
                # Exists but inactive — bubble up so caller returns 404.
                return None
            # Unknown subdomain: fall through to other resolvers.

        # Custom domain exact match.
        org = Organization.objects.filter(custom_domain=host, is_active=True).first()
        if org is not None:
            return org

        # Session-stored tenant (after organization switch).
        session_tenant_id = request.session.get("tenant_id")
        if session_tenant_id:
            org = Organization.objects.filter(pk=session_tenant_id, is_active=True).first()
            if org is not None:
                return org

        # X-Organization header (slug or numeric id).
        header = request.headers.get("X-Organization", "").strip()
        if header:
            org = self._resolve_org_by_header(header)
            if org is not None:
                return org

        return None

    def _resolve_org_by_header(self, value: str) -> "Organization | None":
        qs = Organization.objects.filter(is_active=True)
        if value.isdigit():
            return qs.filter(pk=int(value)).first()
        return qs.filter(slug=value).first()

    def _resolve_membership(
        self, request: "HttpRequest", tenant: "Organization | None"
    ) -> "TenantMembership | None":
        if tenant is None or not getattr(request.user, "is_authenticated", False):
            return None
        return (
            TenantMembership.objects.select_related("role", "tenant")
            .filter(user=request.user, tenant=tenant)
            .first()
        )

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _extract_subdomain(host: str) -> str:
        """Return the leftmost label of ``host`` unless it's a non-tenant label."""
        if not host:
            return ""
        parts = host.split(".")
        if len(parts) < 3:
            # ``localhost`` / ``127.0.0.1`` / ``app.com`` (apex) — no subdomain.
            return ""
        candidate = parts[0].lower()
        if candidate in NON_TENANT_HOST_PREFIXES:
            return ""
        return candidate

    @staticmethod
    def _requested_via_subdomain(request: "HttpRequest") -> bool:
        """Return True if the request URL explicitly carries a tenant subdomain."""
        host = request.get_host().split(":")[0].lower()
        return bool(TenantMiddleware._extract_subdomain(host))


###############################################################################
# Axes reset helper (called by login views on success)
###############################################################################


def reset_axes_for_user(username: str) -> None:
    """Clear django-axes lockout records for ``username`` after a successful login.

    Safe to call when axes is not installed (no-op).
    """
    try:
        from axes.helpers import get_cache  # type: ignore[import-not-found]
    except Exception:
        return
    try:
        cache = get_cache()
        cache.delete_pattern(f"axes:*{username}*")  # type: ignore[attr-defined]
    except Exception:
        # No-op — axes backend handles its own bookkeeping in most configs.
        return


def attach_request_meta(request: "HttpRequest", **extras: Any) -> dict[str, Any]:
    """Build a metadata dict useful for audit logs. Exposed for views/tasks."""
    from .utils import get_client_ip

    return {
        "ip": get_client_ip(request),
        "user_agent": request.META.get("HTTP_USER_AGENT", "")[:512],
        "method": request.method,
        "path": request.path,
        **extras,
    }


def forbidden_json(message: str = "Forbidden.") -> JsonResponse:
    """Helper returning a uniform 403 JSON response."""
    return JsonResponse({"detail": message}, status=403)

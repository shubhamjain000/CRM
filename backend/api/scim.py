"""SCIM 2.0 endpoints for automated user provisioning from an IdP.

Implemented endpoints (mounted at ``/scim/v2/``)::

    GET    /scim/v2/Users           list users (with pagination)
    POST   /scim/v2/Users           create (auto-provisions into the IdP-mapped org)
    GET    /scim/v2/Users/<id>      retrieve
    PUT    /scim/v2/Users/<id>      full replace
    PATCH  /scim/v2/Users/<id>      partial update
    DELETE /scim/v2/Users/<id>      deactivate

Authentication is via a bearer token matched against the mapped organization's
``scim_endpoint_token``. The bearer's identity determines the tenant — the
request handler sets the tenant context so all downstream ORM calls are scoped.

The SCIM attribute mapping (RFC 7643 §4.1) is intentionally minimal:
``userName`` → ``email``, ``name.formatted`` → ``name``, ``active`` →
``is_active_account``, plus a few enterprise extensions.
"""

from __future__ import annotations

import json
import secrets
from typing import Any

from django.db import transaction
from django.http import JsonResponse
from django.views import View
from rest_framework import status

from .managers import set_current_tenant, tenant_context
from .models import Organization, Role, TenantMembership, User
from .utils import audit_log

SCIM_CONTENT_TYPE = "application/scim+json"
SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User"
SCIM_LIST_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:ListResponse"
SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error"


###############################################################################
# Helpers
###############################################################################


def scim_error(status_code: int, detail: str) -> JsonResponse:
    """Return a SCIM-formatted error response."""
    return JsonResponse(
        {"status": str(status_code), "detail": detail, "schemas": [SCIM_ERROR_SCHEMA]},
        status=status_code,
        content_type=SCIM_CONTENT_TYPE,
    )


def scim_user_to_dict(user: User) -> dict[str, Any]:
    """Map a :class:`User` to a SCIM 2.0 ``User`` representation."""
    return {
        "schemas": [SCIM_USER_SCHEMA],
        "id": str(user.pk),
        "userName": user.email,
        "name": {"formatted": user.name},
        "emails": [{"primary": True, "value": user.email, "type": "work"}],
        "active": user.is_active_account,
        "meta": {
            "resourceType": "User",
            "location": f"/scim/v2/Users/{user.pk}",
        },
    }


def resolve_tenant_from_request(request) -> Organization | None:
    """Resolve the tenant from the SCIM bearer token.

    SCIM endpoints are *not* fronted by :class:`TenantMiddleware` (which keys
    off subdomains/headers). Instead, the bearer token is matched against
    ``Organization.scim_endpoint_token``. The first matching active org wins.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    token = auth.split(" ", 1)[1].strip()
    if not token:
        return None
    return Organization.objects.filter(is_active=True, scim_endpoint_token=token).first()


def parse_scim_user(body: dict[str, Any]) -> dict[str, Any]:
    """Extract a normalized field dict from a SCIM ``User`` payload."""
    emails = body.get("emails") or []
    primary_email = next((e["value"] for e in emails if e.get("primary")), None) or (
        emails[0]["value"] if emails else None
    )
    name = body.get("name") or {}
    return {
        "email": (body.get("userName") or primary_email or "").lower(),
        "name": name.get("formatted") or body.get("displayName") or "",
        "active": body.get("active", True),
    }


###############################################################################
# Views
###############################################################################


class ScimUserListView(View):
    """GET lists / POST creates SCIM users."""

    def get(self, request) -> JsonResponse:
        tenant = resolve_tenant_from_request(request)
        if tenant is None:
            return scim_error(401, "Invalid SCIM bearer token.")
        with tenant_context(tenant):
            set_current_tenant(tenant)
            qs = User.objects.filter(memberships__tenant=tenant, memberships__is_active=True).distinct()
            try:
                start = int(request.GET.get("startIndex", 1))
                count = int(request.GET.get("count", 100))
            except ValueError:
                return scim_error(400, "Invalid pagination parameters.")
            start = max(start, 1)
            count = max(1, min(count, 500))
            total = qs.count()
            page = qs.order_by("pk")[start - 1 : start - 1 + count]
            return JsonResponse(
                {
                    "schemas": [SCIM_LIST_SCHEMA],
                    "totalResults": total,
                    "startIndex": start,
                    "itemsPerPage": len(page),
                    "Resources": [scim_user_to_dict(u) for u in page],
                },
                content_type=SCIM_CONTENT_TYPE,
            )

    @transaction.atomic
    def post(self, request) -> JsonResponse:
        tenant = resolve_tenant_from_request(request)
        if tenant is None:
            return scim_error(401, "Invalid SCIM bearer token.")
        try:
            body = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return scim_error(400, "Malformed JSON body.")
        fields = parse_scim_user(body)
        if not fields["email"]:
            return scim_error(400, "userName or primary email is required.")
        if User.objects.filter(email__iexact=fields["email"]).exists():
            return scim_error(409, "User already exists.")
        with tenant_context(tenant):
            set_current_tenant(tenant)
            user = User.objects.create_user(
                email=fields["email"],
                password=secrets.token_urlsafe(32),
                name=fields["name"],
                is_active_account=fields["active"],
            )
            member_role = Role.objects.filter(tenant=tenant, name="member").first() or Role.objects.create(
                tenant=tenant, name="member", permissions=["read"], is_system=True
            )
            TenantMembership.objects.create(user=user, tenant=tenant, role=member_role)
            audit_log(actor=None, action="scim.user.created", target=user, request=request, tenant=tenant)
            return JsonResponse(
                scim_user_to_dict(user), status=status.HTTP_201_CREATED, content_type=SCIM_CONTENT_TYPE
            )


class ScimUserDetailView(View):
    """GET / PUT / PATCH / DELETE a SCIM user by id."""

    def _resolve(self, request, user_id: str) -> tuple[Organization | None, User | None, JsonResponse | None]:
        tenant = resolve_tenant_from_request(request)
        if tenant is None:
            return None, None, scim_error(401, "Invalid SCIM bearer token.")
        with tenant_context(tenant):
            set_current_tenant(tenant)
            user = (
                User.objects.filter(pk=user_id, memberships__tenant=tenant).first()
            )
        if user is None:
            return tenant, None, scim_error(404, "User not found.")
        return tenant, user, None

    def get(self, request, user_id: str) -> JsonResponse:
        tenant, user, err = self._resolve(request, user_id)
        if err is not None:
            return err
        assert user is not None
        return JsonResponse(scim_user_to_dict(user), content_type=SCIM_CONTENT_TYPE)

    @transaction.atomic
    def put(self, request, user_id: str) -> JsonResponse:
        tenant, user, err = self._resolve(request, user_id)
        if err is not None:
            return err
        assert user is not None and tenant is not None
        try:
            body = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return scim_error(400, "Malformed JSON body.")
        fields = parse_scim_user(body)
        with tenant_context(tenant):
            set_current_tenant(tenant)
            user.email = fields["email"] or user.email
            user.name = fields["name"]
            user.is_active_account = fields["active"]
            user.save(update_fields=["email", "name", "is_active_account"])
            audit_log(actor=None, action="scim.user.updated", target=user, request=request, tenant=tenant)
        return JsonResponse(scim_user_to_dict(user), content_type=SCIM_CONTENT_TYPE)

    @transaction.atomic
    def patch(self, request, user_id: str) -> JsonResponse:
        tenant, user, err = self._resolve(request, user_id)
        if err is not None:
            return err
        assert user is not None and tenant is not None
        try:
            body = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return scim_error(400, "Malformed JSON body.")
        with tenant_context(tenant):
            set_current_tenant(tenant)
            for op in body.get("Operations", []):
                path = op.get("path", "")
                value = op.get("value")
                if path == "userName" and value:
                    user.email = str(value).lower()
                elif path == "name.formatted" and value:
                    user.name = str(value)
                elif path == "active" and value is not None:
                    user.is_active_account = bool(value)
            user.save(update_fields=["email", "name", "is_active_account"])
            audit_log(actor=None, action="scim.user.patched", target=user, request=request, tenant=tenant)
        return JsonResponse(scim_user_to_dict(user), content_type=SCIM_CONTENT_TYPE)

    @transaction.atomic
    def delete(self, request, user_id: str) -> JsonResponse:
        tenant, user, err = self._resolve(request, user_id)
        if err is not None:
            return err
        assert user is not None and tenant is not None
        with tenant_context(tenant):
            set_current_tenant(tenant)
            # SCIM DELETE deactivates rather than hard-deletes.
            user.is_active_account = False
            user.save(update_fields=["is_active_account"])
            TenantMembership.objects.filter(user=user, tenant=tenant).update(is_active=False)
            audit_log(actor=None, action="scim.user.deactivated", target=user, request=request, tenant=tenant)
        return JsonResponse(
            {"schemas": [SCIM_LIST_SCHEMA], "status": "204"},
            status=status.HTTP_204_NO_CONTENT,
            content_type=SCIM_CONTENT_TYPE,
        )


def scim_urlpatterns():
    """Return a list of SCIM URL patterns. Imported by ``config/urls.py``."""
    from django.urls import path

    return [
        path("scim/v2/Users", ScimUserListView.as_view(), name="scim-users-list"),
        path("scim/v2/Users/<str:user_id>", ScimUserDetailView.as_view(), name="scim-users-detail"),
    ]


# Re-exported for completeness; the SCIM token is also surfaced via the
# ``Organization.scim_endpoint_token`` field which the org admin sets.
def generate_scim_bearer_token() -> str:
    """Return a new bearer token for an org's SCIM endpoint.

    The org admin stores this in ``Organization.scim_endpoint_token`` and
    configures the IdP to send it as ``Authorization: Bearer <token>``.
    """
    return "scim_" + secrets.token_urlsafe(32)


__all__ = [
    "SCIM_CONTENT_TYPE",
    "ScimUserDetailView",
    "ScimUserListView",
    "generate_scim_bearer_token",
    "scim_urlpatterns",
]

"""SAML 2.0 SP endpoints (djangosaml2-style).

Mounted at ``/saml/`` from the root config. Implements:

* ``GET  /saml/login/``     — initiate SAML login (redirect to the IdP)
* ``POST /saml/acs/``       — assertion consumer service; consumes the response,
                              maps attributes, creates/updates the user + the
                              org membership, issues a JWT, returns JSON (or
                              redirects to the frontend with the tokens).
* ``GET  /saml/metadata/``  — SP metadata XML for the IdP configuration.

The SP is configured per-tenant (settings.SAML2_CONFIG can be a callable that
takes the request and returns the SAML config dict, or a static dict for
single-tenant deployments).
"""

from __future__ import annotations

import logging
from typing import Any

from django.conf import settings
from django.http import HttpRequest, HttpResponse, HttpResponseRedirect
from django.urls import reverse
from django.views import View

from .managers import set_current_tenant, tenant_context
from .models import Organization, Role, TenantMembership, User
from .utils import audit_log, get_client_ip

log = logging.getLogger(__name__)


###############################################################################
# Attribute mapping (IdP attribute → User field)
###############################################################################


SAML_ATTR_MAP_DEFAULT = {
    "email": ("urn:oid:0.9.2342.19200300.100.1.3", "email", "Email"),  # RFC 2798 mail
    "name": ("urn:oid:2.5.4.3", "cn", "displayName"),  # CN / displayName
}


def _first(attrs: dict[str, list[Any]], keys: tuple[str, ...]) -> str:
    """Return the first non-empty value from ``attrs`` matching any of ``keys``."""
    for key in keys:
        values = attrs.get(key)
        if values:
            return str(values[0])
    return ""


def map_saml_attributes(attrs: dict[str, list[Any]]) -> dict[str, str]:
    """Map a SAML attribute dict to a normalized user-fields dict."""
    email = _first(attrs, SAML_ATTR_MAP_DEFAULT["email"])
    name = _first(attrs, SAML_ATTR_MAP_DEFAULT["name"])
    return {"email": email.lower(), "name": name}


###############################################################################
# SAML config resolution
###############################################################################


def get_saml_config(request: HttpRequest | None = None) -> dict[str, Any] | None:
    """Return the SAML2 SP configuration for ``request``.

    Returns ``None`` when SAML is disabled. The configuration may be a dict
    (single-tenant) or a callable ``config(request) -> dict`` (multi-tenant).
    """
    cfg = getattr(settings, "SAML2_CONFIG", None)
    if cfg is None:
        return None
    if callable(cfg):
        try:
            return cfg(request)
        except Exception:
            log.exception("SAML2_CONFIG callable raised; SAML disabled for this request")
            return None
    return cfg


def resolve_tenant_for_saml(request: HttpRequest, attrs: dict[str, list[Any]]) -> Organization | None:
    """Resolve the tenant for an inbound SAML assertion.

    By default the IdP-specified ``Organization`` attribute (or the org
    subdomain in the SP's entityID) is matched. Override this function in
    settings.SAML2_TENANT_RESOLVER for custom logic.
    """
    resolver = getattr(settings, "SAML2_TENANT_RESOLVER", None)
    if callable(resolver):
        try:
            return resolver(request, attrs)
        except Exception:
            log.exception("SAML2_TENANT_RESOLVER raised")
            return None
    subdomain = _first(attrs, ("Organization", "organization", "tenant"))
    if subdomain:
        return Organization.objects.filter(subdomain=subdomain, is_active=True).first()
    return None


###############################################################################
# Views
###############################################################################


class SamlMetadataView(View):
    """Return the SP metadata XML."""

    def get(self, request: HttpRequest) -> HttpResponse:
        cfg = get_saml_config(request)
        if cfg is None:
            return HttpResponse("SAML not configured", status=503)
        try:
            from saml2.config import Config as Saml2Config
            from saml2.metadata import entity_descriptor
        except ImportError:
            return HttpResponse("saml2 library not installed", status=503)

        saml_cfg = Saml2Config()
        saml_cfg.load(cfg)
        saml_cfg.context = "SpMetadata"
        meta = entity_descriptor(saml_cfg)
        xml = str(meta).encode("utf-8")
        return HttpResponse(xml, content_type="application/xml")


class SamlLoginView(View):
    """Initiate a SAML login by redirecting to the IdP."""

    def get(self, request: HttpRequest) -> HttpResponse:
        cfg = get_saml_config(request)
        if cfg is None:
            return HttpResponse("SAML not configured", status=503)
        try:
            from saml2.client import Saml2Client
            from saml2.config import Config as Saml2Config
        except ImportError:
            return HttpResponse("saml2 library not installed", status=503)

        saml_cfg = Saml2Config()
        saml_cfg.load(cfg)
        client = Saml2Client(config=saml_cfg)
        acs_url = request.build_absolute_uri(reverse("saml-acs"))
        try:
            _session_id, request_info = client.prepare_for_authenticate(relay_state=acs_url)
        except Exception:
            log.exception("Failed to prepare SAML authenticate request")
            return HttpResponse("SAML IdP unavailable", status=502)
        headers = dict(request_info.get("headers", []))
        location = headers.get("Location", "")
        if not location:
            return HttpResponse("SAML IdP did not return a redirect", status=502)
        return HttpResponseRedirect(location)


class SamlAcsView(View):
    """Assertion Consumer Service — consume the SAML response.

    On success, returns JSON ``{access, refresh, user}``. The frontend can also
    receive a redirect with the tokens in the URL fragment if
    ``SAML2_FRONTEND_REDIRECT_URL`` is set.
    """

    def post(self, request: HttpRequest) -> HttpResponse:
        cfg = get_saml_config(request)
        if cfg is None:
            return HttpResponse("SAML not configured", status=503)
        try:
            from saml2 import BINDING_HTTP_POST
            from saml2.client import Saml2Client
            from saml2.config import Config as Saml2Config
            from saml2.response import StatusError
        except ImportError:
            return HttpResponse("saml2 library not installed", status=503)

        saml_cfg = Saml2Config()
        saml_cfg.load(cfg)
        client = Saml2Client(config=saml_cfg)
        saml_response = request.POST.get("SAMLResponse", "")
        if not saml_response:
            return HttpResponse("Missing SAMLResponse", status=400)

        try:
            authn_response = client.parse_authn_request_response(
                saml_response, BINDING_HTTP_POST
            )
        except StatusError as exc:
            log.warning("SAML authn status error: %s", exc)
            return HttpResponse("SAML response rejected", status=400)
        except Exception:
            log.exception("SAML response parse failed")
            return HttpResponse("SAML response invalid", status=400)

        attrs = dict(authn_response.ava or {})
        fields = map_saml_attributes(attrs)
        if not fields["email"]:
            return HttpResponse("SAML assertion missing email", status=400)

        tenant = resolve_tenant_for_saml(request, attrs)
        user = self._provision_user(fields)
        if tenant is not None:
            self._ensure_membership(user, tenant)
            set_current_tenant(tenant)

        # Issue JWTs.
        from rest_framework_simplejwt.tokens import RefreshToken

        refresh = RefreshToken.for_user(user)
        tokens = {"access": str(refresh.access_token), "refresh": str(refresh)}

        with tenant_context(tenant):
            audit_log(
                actor=user,
                action="user.login_saml",
                target=user,
                request=request,
                tenant=tenant,
                metadata={"ip": get_client_ip(request)},
            )

        # Either redirect to the frontend with the tokens in the fragment, or
        # return JSON for SPA consumption.
        redirect_url = getattr(settings, "SAML2_FRONTEND_REDIRECT_URL", None)
        if redirect_url:
            location = f"{redirect_url}#access={tokens['access']}&refresh={tokens['refresh']}"
            return HttpResponseRedirect(location)
        from django.http import JsonResponse

        return JsonResponse({"user": {"id": user.pk, "email": user.email, "name": user.name}, **tokens})

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _provision_user(fields: dict[str, str]) -> User:
        """Create or update a user from the SAML-mapped fields.

        Sets an unusable password — SAML users cannot password-login unless an
        admin resets their password.
        """
        user, created = User.objects.get_or_create(
            email=fields["email"],
            defaults={"name": fields["name"]},
        )
        if not created and fields["name"] and user.name != fields["name"]:
            user.name = fields["name"]
            user.save(update_fields=["name"])
        if created:
            user.set_unusable_password()
            user.save(update_fields=["password"])
        return user

    @staticmethod
    def _ensure_membership(user: User, tenant: Organization) -> None:
        """Make sure ``user`` is an active member of ``tenant``.

        Defaults to the ``member`` role (creating it if necessary).
        """
        membership, created = TenantMembership.objects.get_or_create(
            user=user,
            tenant=tenant,
            defaults={
                "role": Role.objects.filter(tenant=tenant, name="member").first()
                or Role.objects.create(
                    tenant=tenant, name="member", permissions=["read"], is_system=True
                ),
            },
        )
        if not created and not membership.is_active:
            membership.is_active = True
            membership.save(update_fields=["is_active"])


def saml_urlpatterns():
    """Return a list of SAML URL patterns. Imported by ``config/urls.py``."""
    from django.urls import path

    return [
        path("saml/login/", SamlLoginView.as_view(), name="saml-login"),
        path("saml/acs/", SamlAcsView.as_view(), name="saml-acs"),
        path("saml/metadata/", SamlMetadataView.as_view(), name="saml-metadata"),
    ]


__all__ = [
    "SamlAcsView",
    "SamlLoginView",
    "SamlMetadataView",
    "map_saml_attributes",
    "saml_urlpatterns",
]

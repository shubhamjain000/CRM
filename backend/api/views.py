"""DRF views for the Foundation auth surface.

Conventions
-----------
* All tenant-scoped endpoints rely on :class:`api.middleware.TenantMiddleware`
  having set ``request.tenant`` and ``request.tenant_membership``. The
  :class:`IsTenantMember` permission enforces this.
* Authentication is SimpleJWT (access 15min / refresh 30d, see settings).
* Mutations are audited via :func:`api.utils.audit_log`.
"""

from __future__ import annotations

from typing import Any

import qrcode
import qrcode.image.svg
from django.contrib.auth import authenticate
from django.db import transaction
from django.http import JsonResponse
from rest_framework import status
from rest_framework.exceptions import (
    AuthenticationFailed,
    NotFound,
    PermissionDenied,
    ValidationError,
)
from rest_framework.generics import CreateAPIView, ListCreateAPIView, RetrieveUpdateDestroyAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.tokens import RefreshToken, TokenError
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .middleware import reset_axes_for_user
from .models import (
    ApiKey,
    AuditLog,
    Device,
    LoginHistory,
    Organization,
    Profile,
    Role,
    TenantMembership,
    User,
    WebAuthnCredential,
)
from .permissions import IsOrgAdmin, IsTenantMember
from .serializers import (
    ApiKeyCreateSerializer,
    ApiKeySerializer,
    AuditLogSerializer,
    DeviceSerializer,
    IpAllowlistSerializer,
    LoginSerializer,
    MagicLinkRequestSerializer,
    MagicLinkVerifySerializer,
    MeSerializer,
    OrganizationSerializer,
    RefreshTokenSerializer,
    RoleSerializer,
    SignupSerializer,
    TwoFactorDisableSerializer,
    TwoFactorSetupResponseSerializer,
    TwoFactorVerifySerializer,
    UserSerializer,
    WebAuthnLoginBeginSerializer,
    WebAuthnLoginFinishSerializer,
    WebAuthnRegisterBeginSerializer,
    WebAuthnRegisterFinishSerializer,
)
from .tasks import send_magic_link, send_suspicious_login_alert
from .utils import (
    audit_log,
    check_ip_allowlist,
    generate_magic_link,
    get_client_ip,
    hash_token,
    password_meets_policy,
    totp_generate_secret,
    totp_provisioning_uri,
    totp_verify,
    verify_magic_link,
    webauthn_generate_challenge,
)


###############################################################################
# Health
###############################################################################


def health(_request: Request) -> JsonResponse:
    """Liveness/readiness probe used by CI and the frontend dashboard.

    Returns a plain Django ``JsonResponse`` so it works whether invoked from a
    DRF viewset or a raw Django URL pattern.
    """
    return JsonResponse(
        {"status": "ok", "service": "foundation-backend", "version": "0.2.0", "phase": "auth"}
    )


###############################################################################
# Helpers
###############################################################################


def _record_login(*, user: User, request: Request, method: str, success: bool) -> None:
    """Persist a :class:`LoginHistory` row."""
    LoginHistory.objects.create(
        user=user,
        tenant=getattr(request, "tenant", None),
        ip=get_client_ip(request),
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:512],
        success=success,
        method=method,
    )


def _issue_jwt_pair(user: User) -> dict[str, str]:
    """Return ``{access, refresh}`` for ``user``."""
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def _store_device(user: User, request: Request, refresh_token: str) -> Device:
    """Persist a :class:`Device` row for ``refresh_token``."""
    return Device.objects.create(
        user=user,
        ip=get_client_ip(request),
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:512],
        refresh_token_hash=hash_token(refresh_token),
    )


###############################################################################
# Auth: signup / login / refresh / logout / me
###############################################################################


class SignupView(APIView):
    """Create a user, a personal organization, an owner role, and a membership."""

    permission_classes = [AllowAny]
    serializer_class = SignupSerializer

    @transaction.atomic
    def post(self, request: Request) -> Response:
        serializer = SignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        ok, errors = password_meets_policy(data["password"])
        if not ok:
            raise ValidationError({"password": errors})

        if User.objects.filter(email__iexact=data["email"]).exists():
            raise ValidationError({"email": "A user with this email already exists."})

        user = User.objects.create_user(
            email=data["email"],
            password=data["password"],
            name=data.get("name", ""),
        )
        # Generate a slug from the org name; fall back to the user's email handle.
        org_name = data.get("organization_name") or f"{user.name or user.email}'s workspace"
        base_slug = (org_name.lower().replace(" ", "-")[:60]) or "workspace"
        slug = base_slug
        subdomain = base_slug
        suffix = 1
        while Organization.objects.filter(slug=slug).exists():
            slug = f"{base_slug}-{suffix}"
            subdomain = f"{base_slug}-{suffix}"
            suffix += 1

        org = Organization.objects.create(name=org_name, slug=slug, subdomain=subdomain)
        owner_role, _ = Role.objects.get_or_create(
            tenant=org,
            name="owner",
            defaults={"permissions": ["*"], "is_system": True},
        )
        TenantMembership.objects.create(user=user, tenant=org, role=owner_role)
        Profile.objects.create(user=user)

        tokens = _issue_jwt_pair(user)
        _store_device(user, request, tokens["refresh"])
        _record_login(user=user, request=request, method="password", success=True)
        audit_log(actor=user, action="user.signup", target=user, request=request, tenant=org)
        return Response(
            {"user": UserSerializer(user).data, "organization": OrganizationSerializer(org).data, **tokens},
            status=status.HTTP_201_CREATED,
        )


class LoginView(TokenObtainPairView):
    """Email/password login. Optional ``totp_code`` enables 2FA enforcement."""

    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = authenticate(
            request,
            username=data["email"],
            password=data["password"],
        )
        if user is None or not user.is_active_account:
            _record_login_failed(request, data["email"])
            raise AuthenticationFailed("Invalid credentials.")

        if user.is_2fa_enabled:
            code = data.get("totp_code", "")
            if not totp_verify(user.totp_secret, code):
                _record_login(user=user, request=request, method="2fa", success=False)
                raise AuthenticationFailed({"detail": "2FA code required.", "code": "totp_required"})

        # IP allowlist enforcement (tenant-scoped if the request carried a tenant).
        tenant = getattr(request, "tenant", None)
        if not check_ip_allowlist(tenant, get_client_ip(request)):
            send_suspicious_login_alert.delay(
                getattr(tenant, "pk", None), user.pk, get_client_ip(request)
            )
            raise PermissionDenied("IP not allowed by organization policy.")

        tokens = _issue_jwt_pair(user)
        _store_device(user, request, tokens["refresh"])
        _record_login(user=user, request=request, method="password", success=True)
        reset_axes_for_user(user.email)
        user.last_login_ip = get_client_ip(request) or user.last_login_ip
        user.save(update_fields=["last_login_ip"])
        audit_log(actor=user, action="user.login", target=user, request=request, tenant=tenant)
        return Response({"user": UserSerializer(user).data, **tokens})


def _record_login_failed(request: Request, email: str) -> None:
    """Record a failed-login row for an unknown/wrong-password user."""
    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        return
    _record_login(user=user, request=request, method="password", success=False)


class RefreshView(TokenRefreshView):
    """Refresh the access token. Revoked devices (refresh_token_hash mismatch) fail."""

    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = RefreshTokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        refresh_str = serializer.validated_data["refresh"]
        refresh_hash = hash_token(refresh_str)
        if not Device.objects.filter(refresh_token_hash=refresh_hash).exists():
            raise AuthenticationFailed("Refresh token revoked.")
        try:
            refresh = RefreshToken(refresh_str)
        except TokenError as exc:
            raise AuthenticationFailed(str(exc)) from exc
        return Response({"access": str(refresh.access_token)})


class LogoutView(APIView):
    """Blacklist the refresh token and delete the matching device row."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = RefreshTokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        refresh_str = serializer.validated_data["refresh"]
        refresh_hash = hash_token(refresh_str)
        Device.objects.filter(refresh_token_hash=refresh_hash).delete()
        try:
            RefreshToken(refresh_str).blacklist()
        except TokenError:
            pass  # expired tokens can still be removed from devices
        audit_log(actor=request.user, action="user.logout", target=request.user, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    """Return the current user, their profile, and active memberships."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        return Response(MeSerializer(request.user, context={"request": request}).data)


###############################################################################
# Magic link
###############################################################################


class MagicLinkRequestView(APIView):
    """Email a one-time magic-link token."""

    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = MagicLinkRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        if not User.objects.filter(email__iexact=email).exists():
            # Do not leak whether the account exists — return 204 anyway.
            return Response(status=status.HTTP_204_NO_CONTENT)
        token = generate_magic_link(email, tenant=getattr(request, "tenant", None))
        send_magic_link.delay(
            getattr(getattr(request, "tenant", None), "pk", None), email, token
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class MagicLinkVerifyView(APIView):
    """Consume a magic-link token and issue JWTs."""

    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = MagicLinkVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = verify_magic_link(serializer.validated_data["token"])
        if user is None:
            raise AuthenticationFailed("Invalid or expired magic link.")
        tokens = _issue_jwt_pair(user)
        _store_device(user, request, tokens["refresh"])
        _record_login(user=user, request=request, method="magic-link", success=True)
        audit_log(actor=user, action="user.login_magic_link", target=user, request=request)
        return Response({"user": UserSerializer(user).data, **tokens})


###############################################################################
# 2FA (TOTP)
###############################################################################


class TwoFactorSetupView(APIView):
    """Generate a new TOTP secret + ``otpauth://`` URI and return a QR SVG."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        secret = totp_generate_secret()
        uri = totp_provisioning_uri(secret, request.user.email, issuer="Foundation")
        # Stash the secret in the session so the verify step can confirm.
        request.session["pending_totp_secret"] = secret
        # Build an SVG QR code for the frontend to render inline.
        img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgImage)
        qr_svg = img.to_string().decode("utf-8")
        data = TwoFactorSetupResponseSerializer({"secret": secret, "otpauth_uri": uri, "qr_svg": qr_svg}).data
        return Response(data)


class TwoFactorVerifyView(APIView):
    """Confirm a pending TOTP secret and enable 2FA on the user."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = TwoFactorVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        secret = request.session.get("pending_totp_secret")
        if not secret:
            raise ValidationError("No pending 2FA setup. Call /auth/2fa/setup first.")
        if not totp_verify(secret, serializer.validated_data["code"]):
            raise AuthenticationFailed("Invalid 2FA code.")
        request.user.totp_secret = secret
        request.user.is_2fa_enabled = True
        request.user.save(update_fields=["totp_secret", "is_2fa_enabled"])
        request.session.pop("pending_totp_secret", None)
        audit_log(actor=request.user, action="user.2fa_enabled", target=request.user, request=request)
        return Response({"enabled": True})


class TwoFactorDisableView(APIView):
    """Disable 2FA after re-verifying the current TOTP code."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = TwoFactorDisableSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not request.user.is_2fa_enabled:
            raise ValidationError("2FA is not enabled.")
        if not totp_verify(request.user.totp_secret, serializer.validated_data["code"]):
            raise AuthenticationFailed("Invalid 2FA code.")
        request.user.totp_secret = ""
        request.user.is_2fa_enabled = False
        request.user.save(update_fields=["totp_secret", "is_2fa_enabled"])
        audit_log(actor=request.user, action="user.2fa_disabled", target=request.user, request=request)
        return Response({"enabled": False})


###############################################################################
# WebAuthn / passkeys
###############################################################################


class WebAuthnRegisterBeginView(APIView):
    """Start WebAuthn registration: return a challenge to be signed by the authenticator."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = WebAuthnRegisterBeginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        challenge = webauthn_generate_challenge()
        request.session["webauthn_register_challenge"] = challenge.hex()
        return Response(
            {
                "challenge": challenge.hex(),
                "rp_id": request.get_host().split(":")[0],
                "rp_name": "Foundation",
                "user_id": str(request.user.pk),
                "user_name": request.user.email,
                "user_display_name": request.user.name or request.user.email,
            }
        )


class WebAuthnRegisterFinishView(APIView):
    """Verify the registration response and persist the credential."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = WebAuthnRegisterFinishSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        challenge_hex = request.session.get("webauthn_register_challenge")
        if not challenge_hex:
            raise ValidationError("No pending WebAuthn registration.")
        challenge = bytes.fromhex(challenge_hex)
        try:
            from .utils import webauthn_verify_registration

            verified = webauthn_verify_registration(
                challenge=challenge,
                credential_response=data["response"],
                rp_id=request.get_host().split(":")[0],
                origin=request.build_absolute_uri("/").rstrip("/"),
                user_id=str(request.user.pk),
                user_name=request.user.email,
            )
        except ValueError as exc:
            raise ValidationError(str(exc)) from exc

        WebAuthnCredential.objects.create(
            user=request.user,
            name=data.get("name", ""),
            credential_id=verified["credential_id"],
            public_key=verified["public_key"],
            sign_count=verified["sign_count"],
        )
        request.session.pop("webauthn_register_challenge", None)
        audit_log(actor=request.user, action="user.passkey_registered", target=request.user, request=request)
        return Response({"registered": True})


class WebAuthnLoginBeginView(APIView):
    """Begin a WebAuthn assertion. Caller supplies an email when known."""

    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = WebAuthnLoginBeginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data.get("email")
        challenge = webauthn_generate_challenge()
        request.session["webauthn_login_challenge"] = challenge.hex()
        if email:
            request.session["webauthn_login_email"] = email.lower()
        return Response(
            {
                "challenge": challenge.hex(),
                "rp_id": request.get_host().split(":")[0],
                "allow_credentials": _allow_credentials_for(email) if email else [],
            }
        )


def _allow_credentials_for(email: str | None) -> list[dict[str, str]]:
    if not email:
        return []
    user = User.objects.filter(email__iexact=email).first()
    if not user:
        return []
    return [
        {"type": "public-key", "id": c.credential_id.hex(), "transports": ["internal", "hybrid"]}
        for c in user.webauthn_credentials.all()
    ]


class WebAuthnLoginFinishView(APIView):
    """Verify a WebAuthn assertion and issue JWTs."""

    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = WebAuthnLoginFinishSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        challenge_hex = request.session.get("webauthn_login_challenge")
        if not challenge_hex:
            raise ValidationError("No pending WebAuthn login.")
        challenge = bytes.fromhex(challenge_hex)
        email = data.get("email") or request.session.get("webauthn_login_email")
        if not email:
            raise ValidationError("Email is required to resolve the credential.")
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            raise AuthenticationFailed("Invalid credentials.")

        cred = _select_credential_by_id(user, data["response"])
        if cred is None:
            raise AuthenticationFailed("Unknown credential.")

        try:
            from .utils import webauthn_verify_assertion

            new_count = webauthn_verify_assertion(
                challenge=challenge,
                assertion_response=data["response"],
                credential_id=bytes(cred.credential_id),
                public_key=bytes(cred.public_key),
                sign_count=cred.sign_count,
                rp_id=request.get_host().split(":")[0],
                origin=request.build_absolute_uri("/").rstrip("/"),
            )
        except ValueError as exc:
            raise AuthenticationFailed(str(exc)) from exc

        cred.sign_count = new_count
        cred.save(update_fields=["sign_count"])
        tokens = _issue_jwt_pair(user)
        _store_device(user, request, tokens["refresh"])
        _record_login(user=user, request=request, method="passkey", success=True)
        audit_log(actor=user, action="user.login_passkey", target=user, request=request)
        request.session.pop("webauthn_login_challenge", None)
        request.session.pop("webauthn_login_email", None)
        return Response({"user": UserSerializer(user).data, **tokens})


def _select_credential_by_id(user: User, response: dict[str, Any]) -> WebAuthnCredential | None:
    raw_id = response.get("id") or response.get("rawId")
    if not raw_id:
        return None
    try:
        if isinstance(raw_id, str):
            cid = bytes.fromhex(raw_id.removeprefix("hex:"))
        else:
            cid = bytes(raw_id)
    except ValueError:
        return None
    return user.webauthn_credentials.filter(credential_id=cid).first()


###############################################################################
# Organization
###############################################################################


class OrganizationListView(APIView):
    """List the organizations the current user is a member of."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        memberships = (
            TenantMembership.objects.select_related("tenant", "role")
            .filter(user=request.user, is_active=True)
        )
        return Response(
            [
                {
                    **OrganizationSerializer(m.tenant).data,
                    "role": m.role.name,
                    "joined_at": m.joined_at,
                }
                for m in memberships
            ]
        )


class OrganizationSwitchView(APIView):
    """Switch the active tenant — stored in the session."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        org_id = request.data.get("organization_id")
        if not org_id:
            raise ValidationError("organization_id is required.")
        membership = TenantMembership.objects.select_related("tenant", "role").filter(
            user=request.user, tenant_id=org_id, is_active=True
        ).first()
        if membership is None:
            raise PermissionDenied("Not a member of that organization.")
        request.session["tenant_id"] = membership.tenant_id
        audit_log(
            actor=request.user,
            action="org.switch",
            target=membership.tenant,
            request=request,
            tenant=membership.tenant,
        )
        return Response(
            {
                "organization": OrganizationSerializer(membership.tenant).data,
                "role": membership.role.name,
            }
        )


###############################################################################
# Users (tenant-scoped, admin only)
###############################################################################


class UserListView(ListCreateAPIView):
    """List the users in the current tenant. Admins only."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsTenantMember, IsOrgAdmin]
    serializer_class = UserSerializer

    def get_queryset(self):
        tenant = self.request.tenant  # type: ignore[attr-defined]
        return (
            User.objects.filter(memberships__tenant=tenant, memberships__is_active=True)
            .distinct()
            .order_by("email")
        )

    def perform_create(self, serializer: UserSerializer) -> None:
        tenant = self.request.tenant  # type: ignore[attr-defined]
        with transaction.atomic():
            user = serializer.save()
            member_role = Role.objects.filter(tenant=tenant, name="member").first() or Role.objects.create(
                tenant=tenant, name="member", permissions=["read"], is_system=True
            )
            TenantMembership.objects.create(user=user, tenant=tenant, role=member_role)
            audit_log(
                actor=self.request.user,
                action="user.invited",
                target=user,
                request=self.request,
                tenant=tenant,
            )


class UserDetailView(RetrieveUpdateDestroyAPIView):
    """Retrieve / update / deactivate a user within the current tenant."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsTenantMember, IsOrgAdmin]
    serializer_class = UserSerializer

    def get_queryset(self):
        tenant = self.request.tenant  # type: ignore[attr-defined]
        return User.objects.filter(memberships__tenant=tenant)

    def perform_destroy(self, instance: User) -> None:
        # Deactivate the membership rather than hard-delete the user (who may
        # belong to other tenants).
        tenant = self.request.tenant  # type: ignore[attr-defined]
        TenantMembership.objects.filter(user=instance, tenant=tenant).update(is_active=False)
        audit_log(
            actor=self.request.user,
            action="user.deactivated",
            target=instance,
            request=self.request,
            tenant=tenant,
        )


###############################################################################
# Roles
###############################################################################


class RoleListView(ListCreateAPIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsTenantMember, IsOrgAdmin]
    serializer_class = RoleSerializer

    def get_queryset(self):
        tenant = self.request.tenant  # type: ignore[attr-defined]
        return Role.objects.filter(tenant=tenant).order_by("name")

    def perform_create(self, serializer: RoleSerializer) -> None:
        tenant = self.request.tenant  # type: ignore[attr-defined]
        role = serializer.save(tenant=tenant)
        audit_log(
            actor=self.request.user, action="role.created", target=role, request=self.request, tenant=tenant
        )


class RoleDetailView(RetrieveUpdateDestroyAPIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsTenantMember, IsOrgAdmin]
    serializer_class = RoleSerializer

    def get_queryset(self):
        tenant = self.request.tenant  # type: ignore[attr-defined]
        return Role.objects.filter(tenant=tenant)

    def perform_destroy(self, instance: Role) -> None:
        if instance.is_system:
            raise PermissionDenied("System roles cannot be deleted.")
        super().perform_destroy(instance)


###############################################################################
# Audit log
###############################################################################


class AuditLogListView(APIView):
    """Tenant-scoped audit log, filterable by action / actor."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsTenantMember, IsOrgAdmin]

    def get(self, request: Request) -> Response:
        tenant = request.tenant  # type: ignore[attr-defined]
        qs = AuditLog.objects.filter(tenant=tenant).order_by("-created_at")
        action = request.query_params.get("action")
        if action:
            qs = qs.filter(action__icontains=action)
        actor = request.query_params.get("actor")
        if actor:
            qs = qs.filter(actor__email__iexact=actor)
        since = request.query_params.get("since")
        if since:
            qs = qs.filter(created_at__gte=since)
        limit = min(int(request.query_params.get("limit", 200)), 1000)
        return Response(AuditLogSerializer(qs[:limit], many=True).data)


###############################################################################
# Devices
###############################################################################


class DeviceListView(APIView):
    """List the current user's trusted devices."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        qs = Device.objects.filter(user=request.user).order_by("-last_seen")
        return Response(DeviceSerializer(qs, many=True).data)


class DeviceRevokeView(APIView):
    """Revoke (delete) a device by id, belonging to the current user."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def delete(self, request: Request, device_id: int) -> Response:
        device = Device.objects.filter(pk=device_id, user=request.user).first()
        if device is None:
            raise NotFound("Device not found.")
        device.delete()
        audit_log(actor=request.user, action="device.revoked", target=device, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


###############################################################################
# API keys
###############################################################################


class ApiKeyListView(APIView):
    """List API keys for the current user in the current tenant."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsTenantMember]

    def get(self, request: Request) -> Response:
        tenant = request.tenant  # type: ignore[attr-defined]
        qs = ApiKey.objects.filter(user=request.user, tenant=tenant).order_by("-created_at")
        return Response(ApiKeySerializer(qs, many=True).data)


class ApiKeyCreateView(CreateAPIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsTenantMember]
    serializer_class = ApiKeyCreateSerializer

    def perform_create(self, serializer: ApiKeyCreateSerializer) -> None:
        api_key = serializer.save(user=self.request.user, tenant=self.request.tenant)  # type: ignore[attr-defined]
        audit_log(
            actor=self.request.user,
            action="api_key.created",
            target=api_key,
            request=self.request,
            tenant=self.request.tenant,  # type: ignore[attr-defined]
        )


class ApiKeyRevokeView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsTenantMember]

    def delete(self, request: Request, key_id: int) -> Response:
        tenant = request.tenant  # type: ignore[attr-defined]
        api_key = ApiKey.objects.filter(pk=key_id, user=request.user, tenant=tenant).first()
        if api_key is None:
            raise NotFound("API key not found.")
        api_key.delete()
        audit_log(actor=request.user, action="api_key.revoked", target=api_key, request=request, tenant=tenant)
        return Response(status=status.HTTP_204_NO_CONTENT)


###############################################################################
# IP allowlist (org admin)
###############################################################################


class IPAllowlistView(APIView):
    """Read / update the current tenant's IP allowlist."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsTenantMember, IsOrgAdmin]

    def get(self, request: Request) -> Response:
        tenant = request.tenant  # type: ignore[attr-defined]
        return Response({"allowlist": list(tenant.ip_allowlist or [])})

    def put(self, request: Request) -> Response:
        tenant = request.tenant  # type: ignore[attr-defined]
        serializer = IpAllowlistSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tenant.ip_allowlist = serializer.validated_data["allowlist"]
        tenant.save(update_fields=["ip_allowlist"])
        audit_log(
            actor=request.user,
            action="org.ip_allowlist_updated",
            target=tenant,
            request=request,
            tenant=tenant,
        )
        return Response({"allowlist": list(tenant.ip_allowlist or [])})


# Silence unused-import warnings for symbols that are part of the public API
# surface (re-exported for the URL router).
__all__ = [
    "ApiKeyCreateView",
    "ApiKeyListView",
    "ApiKeyRevokeView",
    "AuditLogListView",
    "DeviceListView",
    "DeviceRevokeView",
    "IPAllowlistView",
    "LoginView",
    "LogoutView",
    "MagicLinkRequestView",
    "MagicLinkVerifyView",
    "MeView",
    "OrganizationListView",
    "OrganizationSwitchView",
    "RefreshView",
    "RoleDetailView",
    "RoleListView",
    "SignupView",
    "TwoFactorDisableView",
    "TwoFactorSetupView",
    "TwoFactorVerifyView",
    "UserDetailView",
    "UserListView",
    "WebAuthnLoginBeginView",
    "WebAuthnLoginFinishView",
    "WebAuthnRegisterBeginView",
    "WebAuthnRegisterFinishView",
    "health",
]

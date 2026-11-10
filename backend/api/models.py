"""Database models for the Foundation platform.

Design notes
------------
* ``User`` is global — one identity may belong to many organizations via
  :class:`TenantMembership`. It does *not* carry a ``tenant`` FK.
* Tenant-scoped models inherit :class:`TenantModel` and use
  :class:`api.managers.TenantManager`, which transparently filters by the
  thread-local tenant set by :class:`api.middleware.TenantMiddleware` or the
  :func:`api.managers.tenant_context` context manager.
* ``TimestampedModel`` adds ``created_at`` / ``updated_at``.
* Sensitive fields (TOTP secret, OAuth tokens, API key hashes) are never
  serialized by the API — see :mod:`api.serializers`.
"""

from __future__ import annotations

from django.contrib.auth.models import AbstractUser
from django.contrib.contenttypes.models import ContentType
from django.db import models
from django.utils import timezone

from .managers import TenantManager


###############################################################################
# Abstract bases
###############################################################################


class TimestampedModel(models.Model):
    """Add ``created_at`` / ``updated_at`` to concrete models."""

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class TenantModel(TimestampedModel):
    """Tenant-scoped base. ``tenant`` is a non-null FK to :class:`Organization`.

    Concrete subclasses inherit ``objects = TenantManager()`` automatically.
    """

    tenant = models.ForeignKey(
        "api.Organization",
        on_delete=models.CASCADE,
        related_name="+",
        db_index=True,
    )

    objects = TenantManager()

    class Meta:
        abstract = True


###############################################################################
# Identity
###############################################################################


class User(AbstractUser):
    """Email-based user. ``username`` is kept for Django internals but unused."""

    # Remove the unique constraint from username — we authenticate by email.
    username = models.CharField(max_length=150, unique=False, blank=True, null=True)
    email = models.EmailField(unique=True, db_index=True)
    name = models.CharField(max_length=255, blank=True)
    is_2fa_enabled = models.BooleanField(default=False)
    totp_secret = models.CharField(max_length=64, blank=True, default="")
    password_changed_at = models.DateTimeField(default=timezone.now)
    last_login_ip = models.GenericIPAddressField(null=True, blank=True)
    is_active_account = models.BooleanField(
        default=True,
        help_text="Designates whether the user can log in. Distinct from Django's is_active which SCIM/axes may flip.",
    )

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        db_table = "auth_user"
        verbose_name = "user"
        verbose_name_plural = "users"

    def __str__(self) -> str:
        return self.email

    def set_password(self, raw_password: str | None) -> None:  # type: ignore[override]
        super().set_password(raw_password)
        self.password_changed_at = timezone.now()


class Organization(TimestampedModel):
    """A tenant. Resolved by subdomain, custom domain, or header."""

    subdomain = models.SlugField(max_length=63, unique=True, db_index=True)
    custom_domain = models.CharField(max_length=255, unique=True, null=True, blank=True)
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=255, unique=True)
    is_active = models.BooleanField(default=True)
    ip_allowlist = models.JSONField(default=list, blank=True)
    # Plan tier — used by feature flags and quota enforcement.
    plan = models.CharField(max_length=32, default="free")
    sso_provider = models.CharField(max_length=32, blank=True, default="")
    scim_endpoint_token = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        db_table = "api_organization"
        verbose_name = "organization"
        verbose_name_plural = "organizations"

    def __str__(self) -> str:
        return self.name


class Role(TimestampedModel):
    """A role inside an organization (or a global system role if ``org`` is None).

    Roles may inherit from a ``parent`` role — permission resolution walks up
    the chain (see :func:`api.permissions.resolve_permissions`).
    """

    name = models.CharField(max_length=100)
    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="roles",
        null=True,
        blank=True,
        db_index=True,
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="children",
    )
    permissions = models.JSONField(default=list, blank=True)
    is_system = models.BooleanField(
        default=False,
        help_text="System roles (owner/admin/member) cannot be deleted.",
    )
    description = models.TextField(blank=True, default="")

    class Meta:
        db_table = "api_role"
        unique_together = (("tenant", "name"),)
        verbose_name = "role"
        verbose_name_plural = "roles"

    def __str__(self) -> str:
        return self.name


class TenantMembership(TimestampedModel):
    """Links a user to an organization with a role."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    tenant = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="memberships")
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="memberships")
    is_active = models.BooleanField(default=True)
    joined_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "api_tenantmembership"
        unique_together = (("user", "tenant"),)
        verbose_name = "tenant membership"
        verbose_name_plural = "tenant memberships"

    def __str__(self) -> str:
        return f"{self.user.email} @ {self.tenant.slug} ({self.role.name})"


class Profile(TimestampedModel):
    """User profile. One-to-one with :class:`User`."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    avatar_url = models.URLField(blank=True, default="")
    phone = models.CharField(max_length=32, blank=True, default="")
    timezone = models.CharField(max_length=64, default="UTC")
    locale = models.CharField(max_length=16, default="en")
    preferences = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "api_profile"

    def __str__(self) -> str:
        return f"Profile({self.user.email})"


class Team(TenantModel):
    """A team inside an organization. May be nested via ``parent``."""

    name = models.CharField(max_length=100)
    parent = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="children",
    )
    lead = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="led_teams",
    )

    class Meta:
        db_table = "api_team"
        unique_together = (("tenant", "name"),)
        verbose_name = "team"
        verbose_name_plural = "teams"

    def __str__(self) -> str:
        return self.name


###############################################################################
# Authentication artifacts
###############################################################################


class LoginHistory(TimestampedModel):
    """Per-login audit row, written by the auth views."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="login_history")
    tenant = models.ForeignKey(
        Organization,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="login_history",
    )
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True, default="")
    success = models.BooleanField(default=True)
    method = models.CharField(
        max_length=32,
        choices=[
            ("password", "password"),
            ("passkey", "passkey"),
            ("oauth", "oauth"),
            ("saml", "saml"),
            ("magic-link", "magic-link"),
            ("2fa", "2fa"),
        ],
        default="password",
    )

    class Meta:
        db_table = "api_loginhistory"
        indexes = [models.Index(fields=["user", "-created_at"])]
        verbose_name = "login history"
        verbose_name_plural = "login histories"

    def __str__(self) -> str:
        return f"{self.user.email} via {self.method} @ {self.created_at:%Y-%m-%d %H:%M}"


class Device(TimestampedModel):
    """A trusted device / long-lived session tied to a refresh token."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="devices")
    name = models.CharField(max_length=255, blank=True, default="")
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True, default="")
    last_seen = models.DateTimeField(default=timezone.now)
    refresh_token_hash = models.CharField(max_length=128, unique=True, db_index=True)

    class Meta:
        db_table = "api_device"
        verbose_name = "device"
        verbose_name_plural = "devices"

    def __str__(self) -> str:
        return f"{self.name or self.user_agent[:40]} ({self.user.email})"


class ApiKey(TenantModel):
    """A tenant-scoped API key for programmatic access."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="api_keys")
    name = models.CharField(max_length=255)
    key_hash = models.CharField(max_length=128, unique=True, db_index=True)
    last_used = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    scopes = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "api_apikey"
        verbose_name = "API key"
        verbose_name_plural = "API keys"

    def __str__(self) -> str:
        return f"{self.name} ({self.user.email})"


class OAuthToken(TimestampedModel):
    """Stored OAuth access/refresh tokens for an external provider."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="oauth_tokens")
    provider = models.CharField(max_length=32, db_index=True)
    provider_uid = models.CharField(max_length=255, blank=True, default="")
    access_token = models.TextField(blank=True, default="")  # encrypted at the application layer
    refresh_token = models.TextField(blank=True, default="")  # encrypted
    expires_at = models.DateTimeField(null=True, blank=True)
    scopes = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "api_oauthtoken"
        unique_together = (("user", "provider", "provider_uid"),)
        verbose_name = "OAuth token"
        verbose_name_plural = "OAuth tokens"

    def __str__(self) -> str:
        return f"{self.provider}:{self.provider_uid} ({self.user.email})"


class WebAuthnCredential(TimestampedModel):
    """A registered WebAuthn / passkey credential for a user."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="webauthn_credentials")
    name = models.CharField(max_length=255, blank=True, default="")
    credential_id = models.BinaryField(unique=True, db_index=True)
    public_key = models.BinaryField()
    sign_count = models.BigIntegerField(default=0)

    class Meta:
        db_table = "api_webauthncredential"
        verbose_name = "WebAuthn credential"
        verbose_name_plural = "WebAuthn credentials"

    def __str__(self) -> str:
        return f"{self.name or 'passkey'} ({self.user.email})"


class PasswordHistory(TimestampedModel):
    """Hashed password snapshots used for the password-history policy."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="password_history")
    password_hash = models.CharField(max_length=255)

    class Meta:
        db_table = "api_passwordhistory"
        indexes = [models.Index(fields=["user", "-created_at"])]
        verbose_name = "password history"
        verbose_name_plural = "password histories"

    def __str__(self) -> str:
        return f"{self.user.email} @ {self.created_at:%Y-%m-%d}"


class MagicLink(TimestampedModel):
    """One-time, short-TTL magic-link token (only hash stored)."""

    email = models.EmailField(db_index=True)
    token_hash = models.CharField(max_length=128, unique=True, db_index=True)
    expires_at = models.DateTimeField()
    used = models.BooleanField(default=False)

    class Meta:
        db_table = "api_magiclink"
        verbose_name = "magic link"
        verbose_name_plural = "magic links"


###############################################################################
# Audit & security
###############################################################################


class AuditLog(TimestampedModel):
    """Append-only audit log. ``target_*`` use Django ContentType framework."""

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_actions",
    )
    action = models.CharField(max_length=100, db_index=True)
    target_type = models.ForeignKey(
        ContentType,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    target_id = models.BigIntegerField(null=True, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "api_auditlog"
        indexes = [
            models.Index(fields=["tenant", "-created_at"]),
            models.Index(fields=["action", "-created_at"]),
        ]
        verbose_name = "audit log"
        verbose_name_plural = "audit logs"

    def __str__(self) -> str:
        return f"{self.action} by {self.actor} @ {self.created_at:%Y-%m-%d %H:%M}"


class FieldSecurity(TimestampedModel):
    """Field-level security policy for a (role, model, field) triple."""

    LEVEL_VISIBLE = "visible"
    LEVEL_READ_ONLY = "read_only"
    LEVEL_HIDDEN = "hidden"
    LEVEL_CHOICES = [
        (LEVEL_VISIBLE, "visible"),
        (LEVEL_READ_ONLY, "read only"),
        (LEVEL_HIDDEN, "hidden"),
    ]

    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="field_security")
    model = models.CharField(max_length=255, help_text="App label + model, e.g. 'api.user'")
    field = models.CharField(max_length=255)
    level = models.CharField(max_length=16, choices=LEVEL_CHOICES, default=LEVEL_VISIBLE)

    class Meta:
        db_table = "api_fieldsecurity"
        unique_together = (("role", "model", "field"),)
        verbose_name = "field security"
        verbose_name_plural = "field security"

    def __str__(self) -> str:
        return f"{self.role.name} {self.model}.{self.field} → {self.level}"

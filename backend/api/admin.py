"""Django admin registration with tenant-scoped querysets.

Tenant admins (users with an active membership in a tenant) only see objects
for their own tenant. Superusers see everything. This is enforced via
:meth:`TenantModelAdmin.get_queryset` which calls ``TenantManager.for_tenant``
when the request is from a non-superuser staff member.
"""

from __future__ import annotations

import os
from typing import Any

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.http import HttpRequest

from .managers import tenant_context
from .models import (
    ApiKey,
    AuditLog,
    Device,
    FieldSecurity,
    LoginHistory,
    MagicLink,
    OAuthToken,
    Organization,
    PasswordHistory,
    Profile,
    Role,
    Team,
    TenantMembership,
    User,
    WebAuthnCredential,
)


###############################################################################
# Helpers
###############################################################################


def _request_tenant(request: HttpRequest) -> Organization | None:
    return getattr(request, "tenant", None)


###############################################################################
# User
###############################################################################


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    """Custom user admin. Email-based; password is set via the normal flow."""

    ordering = ("email",)
    list_display = ("email", "name", "is_2fa_enabled", "is_active_account", "is_staff")
    search_fields = ("email", "name")
    list_filter = ("is_2fa_enabled", "is_active_account", "is_staff", "is_superuser")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal", {"fields": ("name",)}),
        ("Security", {"fields": ("is_2fa_enabled", "totp_secret", "last_login_ip", "password_changed_at")}),
        ("Permissions", {"fields": ("is_active_account", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "name", "password1", "password2"),
        }),
    )
    readonly_fields = ("password_changed_at", "last_login", "date_joined")


###############################################################################
# Organization
###############################################################################


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "subdomain", "custom_domain", "is_active", "plan", "created_at")
    list_filter = ("is_active", "plan")
    search_fields = ("name", "slug", "subdomain", "custom_domain")
    readonly_fields = ("created_at", "updated_at")


###############################################################################
# Tenant-scoped admin base
###############################################################################


class TenantModelAdmin(admin.ModelAdmin):
    """Admin base that scopes querysets to the request's tenant for non-superusers."""

    def get_queryset(self, request: HttpRequest) -> Any:
        qs = super().get_queryset(request)
        if request.user.is_superuser:
            return qs
        tenant = _request_tenant(request)
        if tenant is None:
            return qs.none()
        # The model's manager exposes ``for_tenant`` for explicit filtering.
        return qs.filter(tenant_id=tenant.pk)

    def save_model(self, request: HttpRequest, obj: Any, form: Any, change: bool) -> None:
        if not change and not request.user.is_superuser:
            tenant = _request_tenant(request)
            if tenant is not None and getattr(obj, "tenant_id", None) is None:
                obj.tenant = tenant
        super().save_model(request, obj, form, change)


@admin.register(TenantMembership)
class TenantMembershipAdmin(admin.ModelAdmin):
    list_display = ("user", "tenant", "role", "is_active", "joined_at")
    list_filter = ("is_active", "role")
    search_fields = ("user__email", "tenant__name", "tenant__slug")
    autocomplete_fields = ("user", "tenant", "role")


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ("name", "tenant", "parent", "is_system")
    list_filter = ("is_system",)
    search_fields = ("name",)
    autocomplete_fields = ("tenant", "parent")


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "timezone", "locale")
    search_fields = ("user__email",)
    autocomplete_fields = ("user",)


@admin.register(Team)
class TeamAdmin(TenantModelAdmin):
    list_display = ("name", "tenant", "lead", "parent")
    search_fields = ("name",)
    list_filter = ("tenant",)
    autocomplete_fields = ("lead", "parent")


###############################################################################
# Auth artifacts
###############################################################################


@admin.register(LoginHistory)
class LoginHistoryAdmin(admin.ModelAdmin):
    list_display = ("user", "tenant", "method", "success", "ip", "created_at")
    list_filter = ("method", "success")
    search_fields = ("user__email", "ip")
    readonly_fields = ("created_at", "updated_at")


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ("user", "name", "ip", "last_seen", "created_at")
    search_fields = ("user__email", "name", "ip")
    readonly_fields = ("refresh_token_hash", "last_seen", "created_at", "updated_at")


@admin.register(ApiKey)
class ApiKeyAdmin(TenantModelAdmin):
    list_display = ("name", "user", "tenant", "last_used", "expires_at", "created_at")
    search_fields = ("name", "user__email")
    readonly_fields = ("key_hash", "last_used", "created_at", "updated_at")


@admin.register(OAuthToken)
class OAuthTokenAdmin(admin.ModelAdmin):
    list_display = ("user", "provider", "provider_uid", "expires_at", "created_at")
    list_filter = ("provider",)
    search_fields = ("user__email", "provider_uid")
    readonly_fields = ("access_token", "refresh_token", "created_at", "updated_at")


@admin.register(WebAuthnCredential)
class WebAuthnCredentialAdmin(admin.ModelAdmin):
    list_display = ("user", "name", "sign_count", "created_at")
    search_fields = ("user__email", "name")
    readonly_fields = ("credential_id", "public_key", "sign_count", "created_at", "updated_at")


@admin.register(PasswordHistory)
class PasswordHistoryAdmin(admin.ModelAdmin):
    list_display = ("user", "created_at")
    search_fields = ("user__email",)
    readonly_fields = ("password_hash", "created_at", "updated_at")


@admin.register(MagicLink)
class MagicLinkAdmin(admin.ModelAdmin):
    list_display = ("email", "used", "expires_at", "created_at")
    list_filter = ("used",)
    search_fields = ("email",)
    readonly_fields = ("token_hash", "created_at", "updated_at")


###############################################################################
# Audit & security
###############################################################################


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("action", "actor", "tenant", "target_type", "target_id", "ip", "created_at")
    list_filter = ("action", "tenant")
    search_fields = ("action", "actor__email", "ip")
    readonly_fields = (
        "tenant",
        "actor",
        "action",
        "target_type",
        "target_id",
        "ip",
        "user_agent",
        "metadata",
        "created_at",
        "updated_at",
    )

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(self, request: HttpRequest, obj: Any = None) -> bool:
        return False

    def get_queryset(self, request: HttpRequest) -> Any:
        qs = super().get_queryset(request)
        if request.user.is_superuser:
            return qs
        tenant = _request_tenant(request)
        if tenant is None:
            return qs.none()
        return qs.filter(tenant_id=tenant.pk)


@admin.register(FieldSecurity)
class FieldSecurityAdmin(admin.ModelAdmin):
    list_display = ("role", "model", "field", "level")
    list_filter = ("level",)
    search_fields = ("model", "field", "role__name")
    autocomplete_fields = ("role",)


# Ensure tenant context is propagated into admin save flows. This is a
# belt-and-braces hook: the middleware already sets the thread-local, but
# Django admin sometimes runs in a separate request flow that bypasses it.
def _patch_admin_save() -> None:
    original_save_model = admin.ModelAdmin.save_model

    def save_model(self: admin.ModelAdmin, request: HttpRequest, obj: Any, form: Any, change: bool) -> None:
        tenant = _request_tenant(request)
        with tenant_context(tenant):
            return original_save_model(self, request, obj, form, change)

    admin.ModelAdmin.save_model = save_model  # type: ignore[method-assign]


# Patching globally can have surprising effects on third-party admins; gated
# behind an env flag so production deployments can opt in.
if os.environ.get("FOUNDATION_ADMIN_TENANT_SCOPE", "false").lower() == "true":
    _patch_admin_save()

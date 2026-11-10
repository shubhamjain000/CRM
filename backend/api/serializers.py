"""DRF serializers for the Foundation auth surface.

Sensitive fields (``totp_secret``, ``password`` on write, OAuth tokens, key
hashes, refresh-token hashes) are never exposed to clients.
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

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
from .utils import generate_api_key


###############################################################################
# User
###############################################################################


class UserSerializer(serializers.ModelSerializer):
    """User serializer. ``password`` is write-only."""

    password = serializers.CharField(write_only=True, required=False, trim_whitespace=False)
    memberships = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "name",
            "is_2fa_enabled",
            "is_active_account",
            "password",
            "memberships",
            "password_changed_at",
            "last_login_ip",
            "date_joined",
        ]
        read_only_fields = [
            "id",
            "is_2fa_enabled",
            "password_changed_at",
            "last_login_ip",
            "date_joined",
            "memberships",
        ]

    def get_memberships(self, obj: User) -> list[dict[str, Any]]:
        return [
            {
                "organization_id": m.tenant_id,
                "organization_slug": m.tenant.slug,
                "organization_name": m.tenant.name,
                "role": m.role.name,
                "is_active": m.is_active,
            }
            for m in obj.memberships.filter(is_active=True).select_related("tenant", "role")
        ]

    def create(self, validated_data: dict[str, Any]) -> User:
        password = validated_data.pop("password", None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance: User, validated_data: dict[str, Any]) -> User:
        password = validated_data.pop("password", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class UserProfileSerializer(serializers.ModelSerializer):
    """Read-only profile serializer for ``MeView``."""

    class Meta:
        model = Profile
        fields = ["avatar_url", "phone", "timezone", "locale", "preferences"]


class MeSerializer(serializers.ModelSerializer):
    """Detailed self-serializer used by ``MeView``."""

    profile = UserProfileSerializer(read_only=True)
    memberships = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "name",
            "is_2fa_enabled",
            "is_active_account",
            "profile",
            "memberships",
            "last_login_ip",
            "password_changed_at",
            "date_joined",
        ]
        read_only_fields = fields

    def get_memberships(self, obj: User) -> list[dict[str, Any]]:
        return [
            {
                "organization": OrganizationSerializer(m.tenant).data,
                "role": m.role.name,
                "is_active": m.is_active,
                "joined_at": m.joined_at,
            }
            for m in obj.memberships.filter(is_active=True).select_related("tenant", "role")
        ]


###############################################################################
# Organization & membership
###############################################################################


class OrganizationSerializer(serializers.ModelSerializer[Organization]):
    class Meta:
        model = Organization
        fields = [
            "id",
            "name",
            "slug",
            "subdomain",
            "custom_domain",
            "is_active",
            "plan",
            "sso_provider",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class OrganizationCreateSerializer(serializers.ModelSerializer[Organization]):
    class Meta:
        model = Organization
        fields = ["name", "slug", "subdomain", "plan"]


class RoleSerializer(serializers.ModelSerializer[Role]):
    class Meta:
        model = Role
        fields = ["id", "name", "tenant", "parent", "permissions", "is_system", "description"]
        read_only_fields = ["id", "is_system", "tenant"]


class TenantMembershipSerializer(serializers.ModelSerializer[TenantMembership]):
    user_email = serializers.CharField(source="user.email", read_only=True)
    role_name = serializers.CharField(source="role.name", read_only=True)
    organization_slug = serializers.CharField(source="tenant.slug", read_only=True)

    class Meta:
        model = TenantMembership
        fields = [
            "id",
            "user",
            "user_email",
            "tenant",
            "organization_slug",
            "role",
            "role_name",
            "is_active",
            "joined_at",
        ]
        read_only_fields = ["id", "joined_at", "user_email", "role_name", "organization_slug"]


class TeamSerializer(serializers.ModelSerializer[Team]):
    class Meta:
        model = Team
        fields = ["id", "tenant", "name", "parent", "lead", "created_at"]
        read_only_fields = ["id", "tenant", "created_at"]


###############################################################################
# Auth artifacts (mostly read-only / redacted)
###############################################################################


class LoginHistorySerializer(serializers.ModelSerializer[LoginHistory]):
    user_email = serializers.CharField(source="user.email", read_only=True)

    class Meta:
        model = LoginHistory
        fields = [
            "id",
            "user",
            "user_email",
            "tenant",
            "ip",
            "user_agent",
            "success",
            "method",
            "created_at",
        ]
        read_only_fields = fields


class DeviceSerializer(serializers.ModelSerializer[Device]):
    """Never exposes ``refresh_token_hash``."""

    class Meta:
        model = Device
        fields = ["id", "user", "name", "ip", "user_agent", "last_seen", "created_at"]
        read_only_fields = fields


class ApiKeySerializer(serializers.ModelSerializer[ApiKey]):
    """Output serializer — never exposes ``key_hash``."""

    class Meta:
        model = ApiKey
        fields = ["id", "user", "tenant", "name", "scopes", "last_used", "expires_at", "created_at"]
        read_only_fields = fields


class ApiKeyCreateSerializer(serializers.ModelSerializer[ApiKey]):
    """Input serializer for creating an API key. Returns the raw key once."""

    key = serializers.CharField(read_only=True)

    class Meta:
        model = ApiKey
        fields = ["id", "name", "scopes", "expires_at", "key"]
        read_only_fields = ["id", "key"]

    def create(self, validated_data: dict[str, Any]) -> ApiKey:
        raw_key, key_hash = generate_api_key()
        user = self.context["request"].user
        tenant = self.context["request"].tenant
        api_key = ApiKey.objects.create(
            user=user,
            tenant=tenant,
            name=validated_data["name"],
            key_hash=key_hash,
            scopes=validated_data.get("scopes", []),
            expires_at=validated_data.get("expires_at"),
        )
        # Stash the raw key so to_representation can return it once.
        api_key._raw_key = raw_key  # type: ignore[attr-defined]
        return api_key

    def to_representation(self, instance: ApiKey) -> dict[str, Any]:
        data = super().to_representation(instance)
        data["key"] = getattr(instance, "_raw_key", "")
        return data


class AuditLogSerializer(serializers.ModelSerializer[AuditLog]):
    actor_email = serializers.CharField(source="actor.email", read_only=True, default="")
    target_type = serializers.CharField(source="target_type.model", read_only=True, default="")

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "tenant",
            "actor",
            "actor_email",
            "action",
            "target_type",
            "target_id",
            "ip",
            "user_agent",
            "metadata",
            "created_at",
        ]
        read_only_fields = fields


class FieldSecuritySerializer(serializers.ModelSerializer[FieldSecurity]):
    class Meta:
        model = FieldSecurity
        fields = ["id", "role", "model", "field", "level"]
        read_only_fields = ["id"]


class OAuthTokenSerializer(serializers.ModelSerializer[OAuthToken]):
    """Never exposes ``access_token`` / ``refresh_token``."""

    class Meta:
        model = OAuthToken
        fields = ["id", "provider", "provider_uid", "expires_at", "scopes", "created_at"]
        read_only_fields = fields


class WebAuthnCredentialSerializer(serializers.ModelSerializer[WebAuthnCredential]):
    """Never exposes ``public_key``."""

    class Meta:
        model = WebAuthnCredential
        fields = ["id", "name", "sign_count", "created_at"]
        read_only_fields = fields


class PasswordHistorySerializer(serializers.ModelSerializer[PasswordHistory]):
    class Meta:
        model = PasswordHistory
        fields = ["id", "created_at"]
        read_only_fields = fields


class MagicLinkSerializer(serializers.ModelSerializer[MagicLink]):
    """Admin-only view; token hash redacted."""

    class Meta:
        model = MagicLink
        fields = ["id", "email", "expires_at", "used", "created_at"]
        read_only_fields = fields


###############################################################################
# Auth request serializers (no models)
###############################################################################


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False)
    totp_code = serializers.CharField(required=False, allow_blank=True)


class SignupSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False)
    name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    organization_name = serializers.CharField(max_length=255, required=False, allow_blank=True)


class MagicLinkRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class MagicLinkVerifySerializer(serializers.Serializer):
    token = serializers.CharField(trim_whitespace=False)


class TwoFactorSetupResponseSerializer(serializers.Serializer):
    secret = serializers.CharField()
    otpauth_uri = serializers.CharField()
    qr_svg = serializers.CharField(required=False)


class TwoFactorVerifySerializer(serializers.Serializer):
    code = serializers.CharField(min_length=6, max_length=8)


class TwoFactorDisableSerializer(serializers.Serializer):
    code = serializers.CharField(min_length=6, max_length=8)


class WebAuthnRegisterBeginSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False, allow_blank=True)


class WebAuthnRegisterFinishSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    challenge = serializers.CharField()
    response = serializers.JSONField()


class WebAuthnLoginBeginSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False)


class WebAuthnLoginFinishSerializer(serializers.Serializer):
    challenge = serializers.CharField()
    response = serializers.JSONField()
    email = serializers.EmailField(required=False)


class RefreshTokenSerializer(serializers.Serializer):
    refresh = serializers.CharField(trim_whitespace=False)


class IpAllowlistSerializer(serializers.Serializer):
    allowlist = serializers.ListField(child=serializers.CharField(), allow_empty=True)

"""URL routing for the Foundation auth API.

All auth/account endpoints live under ``/api/``. SCIM is mounted at
``/scim/v2/`` and SAML at ``/saml/`` from the root config (see
``config/urls.py``). The health probe is at ``/health/``.
"""

from __future__ import annotations

from django.urls import path

from . import views

urlpatterns = [
    # ------------------------------------------------------------------ health
    path("health/", views.health, name="health"),

    # ------------------------------------------------------ auth: account flow
    path("auth/signup/", views.SignupView.as_view(), name="auth-signup"),
    path("auth/login/", views.LoginView.as_view(), name="auth-login"),
    path("auth/refresh/", views.RefreshView.as_view(), name="auth-refresh"),
    path("auth/logout/", views.LogoutView.as_view(), name="auth-logout"),
    path("auth/me/", views.MeView.as_view(), name="auth-me"),

    # ----------------------------------------------------- auth: magic links
    path("auth/magic/request/", views.MagicLinkRequestView.as_view(), name="auth-magic-request"),
    path("auth/magic/verify/", views.MagicLinkVerifyView.as_view(), name="auth-magic-verify"),

    # ------------------------------------------------------------- auth: 2FA
    path("auth/2fa/setup/", views.TwoFactorSetupView.as_view(), name="auth-2fa-setup"),
    path("auth/2fa/verify/", views.TwoFactorVerifyView.as_view(), name="auth-2fa-verify"),
    path("auth/2fa/disable/", views.TwoFactorDisableView.as_view(), name="auth-2fa-disable"),

    # ----------------------------------------------------- auth: webauthn
    path(
        "auth/webauthn/register/begin/",
        views.WebAuthnRegisterBeginView.as_view(),
        name="auth-webauthn-register-begin",
    ),
    path(
        "auth/webauthn/register/finish/",
        views.WebAuthnRegisterFinishView.as_view(),
        name="auth-webauthn-register-finish",
    ),
    path(
        "auth/webauthn/login/begin/",
        views.WebAuthnLoginBeginView.as_view(),
        name="auth-webauthn-login-begin",
    ),
    path(
        "auth/webauthn/login/finish/",
        views.WebAuthnLoginFinishView.as_view(),
        name="auth-webauthn-login-finish",
    ),

    # ------------------------------------------------------ organizations
    path("organizations/", views.OrganizationListView.as_view(), name="organization-list"),
    path("organizations/switch/", views.OrganizationSwitchView.as_view(), name="organization-switch"),

    # ------------------------------------------------------------- users
    path("users/", views.UserListView.as_view(), name="user-list"),
    path("users/<int:pk>/", views.UserDetailView.as_view(), name="user-detail"),

    # ------------------------------------------------------------- roles
    path("roles/", views.RoleListView.as_view(), name="role-list"),
    path("roles/<int:pk>/", views.RoleDetailView.as_view(), name="role-detail"),

    # ------------------------------------------------------------- audit
    path("audit/", views.AuditLogListView.as_view(), name="audit-log-list"),

    # ------------------------------------------------------------- devices
    path("devices/", views.DeviceListView.as_view(), name="device-list"),
    path("devices/<int:device_id>/revoke/", views.DeviceRevokeView.as_view(), name="device-revoke"),

    # ------------------------------------------------------------- api keys
    path("api-keys/", views.ApiKeyListView.as_view(), name="apikey-list"),
    path("api-keys/create/", views.ApiKeyCreateView.as_view(), name="apikey-create"),
    path("api-keys/<int:key_id>/revoke/", views.ApiKeyRevokeView.as_view(), name="apikey-revoke"),

    # ----------------------------------------------------- security policy
    path("security/ip-allowlist/", views.IPAllowlistView.as_view(), name="ip-allowlist"),
]

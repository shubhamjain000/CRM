"""Static OpenAPI 3.1 schema for the Foundation auth API.

This module exposes :func:`get_openapi_schema` returning a dict that the
frontend's openapi-typescript codegen consumes to produce a typed client.

When drf-spectacular is installed, the live schema at ``/api/openapi.json``
augments this with request/response examples and pagination. This module is
the source of truth for the surface contract — drf-spectacular views are
configured to merge with it.
"""

from __future__ import annotations

from typing import Any


def _error_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "detail": {"type": "string"},
            "code": {"type": "string"},
        },
        "required": ["detail"],
    }


def _user_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "id": {"type": "integer"},
            "email": {"type": "string", "format": "email"},
            "name": {"type": "string"},
            "is_2fa_enabled": {"type": "boolean"},
            "is_active_account": {"type": "boolean"},
            "password_changed_at": {"type": "string", "format": "date-time", "readOnly": True},
            "last_login_ip": {"type": "string", "readOnly": True, "nullable": True},
            "date_joined": {"type": "string", "format": "date-time", "readOnly": True},
            "password": {"type": "string", "writeOnly": True, "minLength": 12},
            "memberships": {
                "type": "array",
                "items": {"$ref": "#/components/schemas/Membership"},
                "readOnly": True,
            },
        },
        "required": ["email"],
    }


def _membership_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "organization_id": {"type": "integer"},
            "organization_slug": {"type": "string"},
            "organization_name": {"type": "string"},
            "role": {"type": "string"},
            "is_active": {"type": "boolean"},
            "joined_at": {"type": "string", "format": "date-time"},
        },
    }


def _organization_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "id": {"type": "integer", "readOnly": True},
            "name": {"type": "string"},
            "slug": {"type": "string"},
            "subdomain": {"type": "string"},
            "custom_domain": {"type": "string", "nullable": True},
            "is_active": {"type": "boolean"},
            "plan": {"type": "string"},
            "sso_provider": {"type": "string"},
            "created_at": {"type": "string", "format": "date-time", "readOnly": True},
        },
        "required": ["name", "slug", "subdomain"],
    }


def _role_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "id": {"type": "integer", "readOnly": True},
            "name": {"type": "string"},
            "tenant": {"type": "integer", "readOnly": True, "nullable": True},
            "parent": {"type": "integer", "nullable": True},
            "permissions": {"type": "array", "items": {"type": "string"}},
            "is_system": {"type": "boolean", "readOnly": True},
            "description": {"type": "string"},
        },
        "required": ["name"],
    }


def _token_pair_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "access": {"type": "string"},
            "refresh": {"type": "string"},
            "user": {"$ref": "#/components/schemas/User"},
        },
        "required": ["access", "refresh"],
    }


def _refresh_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {"access": {"type": "string"}},
        "required": ["access"],
    }


def _api_key_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "id": {"type": "integer", "readOnly": True},
            "name": {"type": "string"},
            "scopes": {"type": "array", "items": {"type": "string"}},
            "last_used": {"type": "string", "format": "date-time", "readOnly": True, "nullable": True},
            "expires_at": {"type": "string", "format": "date-time", "nullable": True},
            "created_at": {"type": "string", "format": "date-time", "readOnly": True},
            "key": {"type": "string", "readOnly": True},
        },
        "required": ["name"],
    }


def _device_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "id": {"type": "integer", "readOnly": True},
            "name": {"type": "string", "readOnly": True},
            "ip": {"type": "string", "readOnly": True, "nullable": True},
            "user_agent": {"type": "string", "readOnly": True},
            "last_seen": {"type": "string", "format": "date-time", "readOnly": True},
            "created_at": {"type": "string", "format": "date-time", "readOnly": True},
        },
    }


def _audit_log_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "id": {"type": "integer", "readOnly": True},
            "tenant": {"type": "integer", "nullable": True},
            "actor": {"type": "integer", "nullable": True},
            "actor_email": {"type": "string", "readOnly": True},
            "action": {"type": "string", "readOnly": True},
            "target_type": {"type": "string", "readOnly": True},
            "target_id": {"type": "integer", "readOnly": True, "nullable": True},
            "ip": {"type": "string", "readOnly": True, "nullable": True},
            "user_agent": {"type": "string", "readOnly": True},
            "metadata": {"type": "object", "additionalProperties": True, "readOnly": True},
            "created_at": {"type": "string", "format": "date-time", "readOnly": True},
        },
    }


def _security_schemes() -> dict[str, Any]:
    return {
        "bearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": "SimpleJWT access token. Obtain via /api/auth/login or /api/auth/refresh.",
        },
        "scimBearer": {
            "type": "http",
            "scheme": "bearer",
            "description": "Organization SCIM bearer token (set on Organization.scim_endpoint_token).",
        },
    }


def _paths() -> dict[str, Any]:
    paths: dict[str, Any] = {}

    # ---------------------------------------------------------------- /health
    paths["/health/"] = {
        "get": {
            "summary": "Liveness/readiness probe",
            "operationId": "health",
            "tags": ["system"],
            "responses": {
                "200": {
                    "description": "Service is healthy.",
                    "content": {"application/json": {"schema": {"type": "object"}}},
                }
            },
        }
    }

    # ------------------------------------------------------------ /auth/signup
    paths["/api/auth/signup/"] = {
        "post": {
            "summary": "Sign up a new user, create their personal org + owner role",
            "operationId": "authSignup",
            "tags": ["auth"],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "object",
                            "properties": {
                                "email": {"type": "string", "format": "email"},
                                "password": {"type": "string", "minLength": 12},
                                "name": {"type": "string"},
                                "organization_name": {"type": "string"},
                            },
                            "required": ["email", "password"],
                        }
                    }
                },
            },
            "responses": {
                "201": {
                    "description": "User created and tokens issued.",
                    "content": {
                        "application/json": {"schema": {"$ref": "#/components/schemas/TokenPair"}}
                    },
                },
                "400": {"description": "Validation error.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
            },
        }
    }

    # ------------------------------------------------------------- /auth/login
    paths["/api/auth/login/"] = {
        "post": {
            "summary": "Email/password login (with optional TOTP code)",
            "operationId": "authLogin",
            "tags": ["auth"],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "object",
                            "properties": {
                                "email": {"type": "string", "format": "email"},
                                "password": {"type": "string"},
                                "totp_code": {"type": "string"},
                            },
                            "required": ["email", "password"],
                        }
                    }
                },
            },
            "responses": {
                "200": {
                    "description": "Token pair + user.",
                    "content": {
                        "application/json": {"schema": {"$ref": "#/components/schemas/TokenPair"}}
                    },
                },
                "401": {"description": "Invalid credentials / 2FA required.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
            },
        }
    }

    # ----------------------------------------------------------- /auth/refresh
    paths["/api/auth/refresh/"] = {
        "post": {
            "summary": "Issue a new access token from a refresh token",
            "operationId": "authRefresh",
            "tags": ["auth"],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "object",
                            "properties": {"refresh": {"type": "string"}},
                            "required": ["refresh"],
                        }
                    }
                },
            },
            "responses": {
                "200": {
                    "description": "New access token.",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Refresh"}}},
                },
                "401": {"description": "Refresh token invalid or revoked.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
            },
        }
    }

    # ------------------------------------------------------------ /auth/logout
    paths["/api/auth/logout/"] = {
        "post": {
            "summary": "Blacklist a refresh token and revoke the matching device",
            "operationId": "authLogout",
            "tags": ["auth"],
            "security": [{"bearerAuth": []}],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {
                            "type": "object",
                            "properties": {"refresh": {"type": "string"}},
                            "required": ["refresh"],
                        }
                    }
                },
            },
            "responses": {
                "204": {"description": "Logged out."},
                "401": {"description": "Unauthorized.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
            },
        }
    }

    # --------------------------------------------------------------- /auth/me
    paths["/api/auth/me/"] = {
        "get": {
            "summary": "Return the current user with memberships",
            "operationId": "authMe",
            "tags": ["auth"],
            "security": [{"bearerAuth": []}],
            "responses": {
                "200": {
                    "description": "Current user.",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/User"}}},
                },
                "401": {"description": "Unauthorized.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
            },
        }
    }

    # ------------------------------------------------------------ /auth/magic
    paths["/api/auth/magic/request/"] = {
        "post": {
            "summary": "Email a one-time magic-link token",
            "operationId": "authMagicRequest",
            "tags": ["auth"],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"type": "object", "properties": {"email": {"type": "string", "format": "email"}}, "required": ["email"]}
                    }
                },
            },
            "responses": {"204": {"description": "Magic link sent (or email not registered)."}},
        }
    }
    paths["/api/auth/magic/verify/"] = {
        "post": {
            "summary": "Consume a magic-link token and issue JWTs",
            "operationId": "authMagicVerify",
            "tags": ["auth"],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"type": "object", "properties": {"token": {"type": "string"}}, "required": ["token"]}
                    }
                },
            },
            "responses": {
                "200": {"description": "Token pair + user.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/TokenPair"}}}},
                "401": {"description": "Invalid or expired token.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
            },
        }
    }

    # ------------------------------------------------------------- /auth/2fa/*
    paths["/api/auth/2fa/setup/"] = {
        "post": {
            "summary": "Generate a TOTP secret + QR URI",
            "operationId": "auth2faSetup",
            "tags": ["2fa"],
            "security": [{"bearerAuth": []}],
            "responses": {
                "200": {
                    "description": "TOTP secret + otpauth URI + QR SVG.",
                    "content": {
                        "application/json": {
                            "schema": {
                                "type": "object",
                                "properties": {
                                    "secret": {"type": "string"},
                                    "otpauth_uri": {"type": "string"},
                                    "qr_svg": {"type": "string"},
                                },
                            }
                        }
                    },
                }
            },
        }
    }
    paths["/api/auth/2fa/verify/"] = {
        "post": {
            "summary": "Verify a pending TOTP code and enable 2FA",
            "operationId": "auth2faVerify",
            "tags": ["2fa"],
            "security": [{"bearerAuth": []}],
            "requestBody": {
                "required": True,
                "content": {"application/json": {"schema": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]}}},
            },
            "responses": {
                "200": {"description": "2FA enabled.", "content": {"application/json": {"schema": {"type": "object", "properties": {"enabled": {"type": "boolean"}}}}}},
                "401": {"description": "Invalid code.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
            },
        }
    }
    paths["/api/auth/2fa/disable/"] = {
        "post": {
            "summary": "Disable 2FA after re-verifying the current code",
            "operationId": "auth2faDisable",
            "tags": ["2fa"],
            "security": [{"bearerAuth": []}],
            "requestBody": {
                "required": True,
                "content": {"application/json": {"schema": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]}}},
            },
            "responses": {
                "200": {"description": "2FA disabled.", "content": {"application/json": {"schema": {"type": "object", "properties": {"enabled": {"type": "boolean"}}}}}},
            },
        }
    }

    # ------------------------------------------------------ /auth/webauthn/*
    webauthn_paths = {
        "/api/auth/webauthn/register/begin/": ("authWebauthnRegisterBegin", "Begin passkey registration"),
        "/api/auth/webauthn/register/finish/": ("authWebauthnRegisterFinish", "Finish passkey registration"),
        "/api/auth/webauthn/login/begin/": ("authWebauthnLoginBegin", "Begin passkey login"),
        "/api/auth/webauthn/login/finish/": ("authWebauthnLoginFinish", "Finish passkey login"),
    }
    for path, (op_id, summary) in webauthn_paths.items():
        paths[path] = {
            "post": {
                "summary": summary,
                "operationId": op_id,
                "tags": ["webauthn"],
                "security": [] if "login" in op_id.lower() else [{"bearerAuth": []}],
                "requestBody": {
                    "required": True,
                    "content": {"application/json": {"schema": {"type": "object"}}},
                },
                "responses": {
                    "200": {"description": "Success.", "content": {"application/json": {"schema": {"type": "object"}}}},
                    "400": {"description": "Bad request.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
                },
            }
        }

    # ------------------------------------------------------------ /organizations
    paths["/api/organizations/"] = {
        "get": {
            "summary": "List the organizations the current user is a member of",
            "operationId": "organizationList",
            "tags": ["organizations"],
            "security": [{"bearerAuth": []}],
            "responses": {
                "200": {
                    "description": "Organization list.",
                    "content": {"application/json": {"schema": {"type": "array", "items": {"$ref": "#/components/schemas/Organization"}}}},
                }
            },
        }
    }
    paths["/api/organizations/switch/"] = {
        "post": {
            "summary": "Switch the active organization (stored in session)",
            "operationId": "organizationSwitch",
            "tags": ["organizations"],
            "security": [{"bearerAuth": []}],
            "requestBody": {
                "required": True,
                "content": {"application/json": {"schema": {"type": "object", "properties": {"organization_id": {"type": "integer"}}, "required": ["organization_id"]}}},
            },
            "responses": {
                "200": {"description": "Active org + role.", "content": {"application/json": {"schema": {"type": "object"}}}},
                "403": {"description": "Not a member.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
            },
        }
    }

    # ------------------------------------------------------------------ /users
    paths["/api/users/"] = {
        "get": {
            "summary": "List users in the current tenant (admin only)",
            "operationId": "userList",
            "tags": ["users"],
            "security": [{"bearerAuth": []}],
            "responses": {
                "200": {"description": "User list.", "content": {"application/json": {"schema": {"type": "array", "items": {"$ref": "#/components/schemas/User"}}}}},
                "403": {"description": "Forbidden.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
            },
        },
        "post": {
            "summary": "Invite a user to the current tenant",
            "operationId": "userCreate",
            "tags": ["users"],
            "security": [{"bearerAuth": []}],
            "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/User"}}}},
            "responses": {
                "201": {"description": "User created.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/User"}}}},
            },
        },
    }
    paths["/api/users/{id}/"] = {
        "get": {
            "summary": "Retrieve a user",
            "operationId": "userRetrieve",
            "tags": ["users"],
            "security": [{"bearerAuth": []}],
            "parameters": [{"in": "path", "name": "id", "required": True, "schema": {"type": "integer"}}],
            "responses": {"200": {"description": "User.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/User"}}}}},
        },
        "put": {
            "summary": "Update a user",
            "operationId": "userUpdate",
            "tags": ["users"],
            "security": [{"bearerAuth": []}],
            "parameters": [{"in": "path", "name": "id", "required": True, "schema": {"type": "integer"}}],
            "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/User"}}}},
            "responses": {"200": {"description": "Updated user.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/User"}}}}},
        },
        "delete": {
            "summary": "Deactivate a user's membership in the current tenant",
            "operationId": "userDestroy",
            "tags": ["users"],
            "security": [{"bearerAuth": []}],
            "parameters": [{"in": "path", "name": "id", "required": True, "schema": {"type": "integer"}}],
            "responses": {"204": {"description": "Deactivated."}},
        },
    }

    # ------------------------------------------------------------------ /roles
    paths["/api/roles/"] = {
        "get": {"summary": "List roles", "operationId": "roleList", "tags": ["roles"], "security": [{"bearerAuth": []}], "responses": {"200": {"description": "Roles.", "content": {"application/json": {"schema": {"type": "array", "items": {"$ref": "#/components/schemas/Role"}}}}}}},
        "post": {"summary": "Create a role", "operationId": "roleCreate", "tags": ["roles"], "security": [{"bearerAuth": []}], "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Role"}}}}, "responses": {"201": {"description": "Role created.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Role"}}}}}},
    }
    paths["/api/roles/{id}/"] = {
        "get": {"summary": "Retrieve a role", "operationId": "roleRetrieve", "tags": ["roles"], "security": [{"bearerAuth": []}], "parameters": [{"in": "path", "name": "id", "required": True, "schema": {"type": "integer"}}], "responses": {"200": {"description": "Role.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Role"}}}}}},
        "put": {"summary": "Update a role", "operationId": "roleUpdate", "tags": ["roles"], "security": [{"bearerAuth": []}], "parameters": [{"in": "path", "name": "id", "required": True, "schema": {"type": "integer"}}], "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Role"}}}}, "responses": {"200": {"description": "Role updated.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Role"}}}}}},
        "delete": {"summary": "Delete a non-system role", "operationId": "roleDestroy", "tags": ["roles"], "security": [{"bearerAuth": []}], "parameters": [{"in": "path", "name": "id", "required": True, "schema": {"type": "integer"}}], "responses": {"204": {"description": "Deleted."}}},
    }

    # ----------------------------------------------------------------- /audit
    paths["/api/audit/"] = {
        "get": {
            "summary": "List audit log entries (tenant-scoped, filterable)",
            "operationId": "auditList",
            "tags": ["audit"],
            "security": [{"bearerAuth": []}],
            "parameters": [
                {"in": "query", "name": "action", "schema": {"type": "string"}},
                {"in": "query", "name": "actor", "schema": {"type": "string"}},
                {"in": "query", "name": "since", "schema": {"type": "string", "format": "date-time"}},
                {"in": "query", "name": "limit", "schema": {"type": "integer", "default": 200, "maximum": 1000}},
            ],
            "responses": {"200": {"description": "Audit entries.", "content": {"application/json": {"schema": {"type": "array", "items": {"$ref": "#/components/schemas/AuditLog"}}}}}},
        }
    }

    # --------------------------------------------------------------- /devices
    paths["/api/devices/"] = {
        "get": {"summary": "List the current user's trusted devices", "operationId": "deviceList", "tags": ["devices"], "security": [{"bearerAuth": []}], "responses": {"200": {"description": "Devices.", "content": {"application/json": {"schema": {"type": "array", "items": {"$ref": "#/components/schemas/Device"}}}}}}},
    }
    paths["/api/devices/{device_id}/revoke/"] = {
        "delete": {
            "summary": "Revoke (delete) a device",
            "operationId": "deviceRevoke",
            "tags": ["devices"],
            "security": [{"bearerAuth": []}],
            "parameters": [{"in": "path", "name": "device_id", "required": True, "schema": {"type": "integer"}}],
            "responses": {"204": {"description": "Revoked."}, "404": {"description": "Not found.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}}},
        }
    }

    # ------------------------------------------------------------- /api-keys/*
    paths["/api/api-keys/"] = {
        "get": {"summary": "List API keys for the current user in the current tenant", "operationId": "apikeyList", "tags": ["api-keys"], "security": [{"bearerAuth": []}], "responses": {"200": {"description": "API keys.", "content": {"application/json": {"schema": {"type": "array", "items": {"$ref": "#/components/schemas/ApiKey"}}}}}}},
    }
    paths["/api/api-keys/create/"] = {
        "post": {
            "summary": "Create an API key (returns the raw key once)",
            "operationId": "apikeyCreate",
            "tags": ["api-keys"],
            "security": [{"bearerAuth": []}],
            "requestBody": {"required": True, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ApiKey"}}}},
            "responses": {"201": {"description": "API key created.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ApiKey"}}}}},
        }
    }
    paths["/api/api-keys/{key_id}/revoke/"] = {
        "delete": {
            "summary": "Revoke an API key",
            "operationId": "apikeyRevoke",
            "tags": ["api-keys"],
            "security": [{"bearerAuth": []}],
            "parameters": [{"in": "path", "name": "key_id", "required": True, "schema": {"type": "integer"}}],
            "responses": {"204": {"description": "Revoked."}},
        }
    }

    # --------------------------------------------------- /security/ip-allowlist
    paths["/api/security/ip-allowlist/"] = {
        "get": {
            "summary": "Read the current tenant's IP allowlist",
            "operationId": "ipAllowlistRead",
            "tags": ["security"],
            "security": [{"bearerAuth": []}],
            "responses": {"200": {"description": "Allowlist.", "content": {"application/json": {"schema": {"type": "object", "properties": {"allowlist": {"type": "array", "items": {"type": "string"}}}}}}}},
        },
        "put": {
            "summary": "Replace the current tenant's IP allowlist",
            "operationId": "ipAllowlistUpdate",
            "tags": ["security"],
            "security": [{"bearerAuth": []}],
            "requestBody": {"required": True, "content": {"application/json": {"schema": {"type": "object", "properties": {"allowlist": {"type": "array", "items": {"type": "string"}}}}}}},
            "responses": {"200": {"description": "Updated allowlist.", "content": {"application/json": {"schema": {"type": "object", "properties": {"allowlist": {"type": "array", "items": {"type": "string"}}}}}}}},
        },
    }

    # ------------------------------------------------------------ SCIM /scim/v2
    paths["/scim/v2/Users"] = {
        "get": {
            "summary": "List SCIM users (auto-provisioned into the IdP-mapped org)",
            "operationId": "scimUserList",
            "tags": ["scim"],
            "security": [{"scimBearer": []}],
            "parameters": [
                {"in": "query", "name": "startIndex", "schema": {"type": "integer", "default": 1}},
                {"in": "query", "name": "count", "schema": {"type": "integer", "default": 100, "maximum": 500}},
            ],
            "responses": {"200": {"description": "ListResponse.", "content": {"application/scim+json": {"schema": {"type": "object"}}}}},
        },
        "post": {
            "summary": "Create a SCIM user (provisions User + TenantMembership)",
            "operationId": "scimUserCreate",
            "tags": ["scim"],
            "security": [{"scimBearer": []}],
            "requestBody": {"required": True, "content": {"application/scim+json": {"schema": {"type": "object"}}}},
            "responses": {
                "201": {"description": "User created.", "content": {"application/scim+json": {"schema": {"type": "object"}}}},
                "409": {"description": "Conflict.", "content": {"application/scim+json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
            },
        },
    }
    paths["/scim/v2/Users/{id}"] = {
        "get": {"summary": "Retrieve a SCIM user", "operationId": "scimUserRetrieve", "tags": ["scim"], "security": [{"scimBearer": []}], "parameters": [{"in": "path", "name": "id", "required": True, "schema": {"type": "string"}}], "responses": {"200": {"description": "User.", "content": {"application/scim+json": {"schema": {"type": "object"}}}}}},
        "put": {"summary": "Replace a SCIM user", "operationId": "scimUserReplace", "tags": ["scim"], "security": [{"scimBearer": []}], "parameters": [{"in": "path", "name": "id", "required": True, "schema": {"type": "string"}}], "requestBody": {"required": True, "content": {"application/scim+json": {"schema": {"type": "object"}}}}, "responses": {"200": {"description": "User.", "content": {"application/scim+json": {"schema": {"type": "object"}}}}}},
        "patch": {"summary": "Patch a SCIM user", "operationId": "scimUserPatch", "tags": ["scim"], "security": [{"scimBearer": []}], "parameters": [{"in": "path", "name": "id", "required": True, "schema": {"type": "string"}}], "requestBody": {"required": True, "content": {"application/scim+json": {"schema": {"type": "object"}}}}, "responses": {"200": {"description": "User.", "content": {"application/scim+json": {"schema": {"type": "object"}}}}}},
        "delete": {"summary": "Deactivate a SCIM user", "operationId": "scimUserDelete", "tags": ["scim"], "security": [{"scimBearer": []}], "parameters": [{"in": "path", "name": "id", "required": True, "schema": {"type": "string"}}], "responses": {"204": {"description": "Deactivated."}}},
    }

    # ------------------------------------------------------------- SAML /saml/*
    paths["/saml/login/"] = {
        "get": {"summary": "Initiate a SAML login (redirect to the IdP)", "operationId": "samlLogin", "tags": ["saml"], "responses": {"302": {"description": "Redirect to IdP."}, "503": {"description": "SAML not configured."}}},
    }
    paths["/saml/acs/"] = {
        "post": {"summary": "SAML Assertion Consumer Service — consume the response and issue JWTs", "operationId": "samlAcs", "tags": ["saml"], "requestBody": {"required": True, "content": {"application/x-www-form-urlencoded": {"schema": {"type": "object", "properties": {"SAMLResponse": {"type": "string"}}}}}}, "responses": {"200": {"description": "Token pair + user.", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/TokenPair"}}}}, "302": {"description": "Redirect with tokens in fragment."}}},
    }
    paths["/saml/metadata/"] = {
        "get": {"summary": "SP metadata XML for the IdP configuration", "operationId": "samlMetadata", "tags": ["saml"], "responses": {"200": {"description": "XML metadata.", "content": {"application/xml": {"schema": {"type": "string"}}}}, "503": {"description": "SAML not configured."}}},
    }

    return paths


def get_openapi_schema() -> dict[str, Any]:
    """Return the OpenAPI 3.1 schema dict for the Foundation auth API."""
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "Foundation Auth API",
            "version": "0.2.0",
            "description": (
                "Multi-tenant enterprise auth surface: email/password + 2FA (TOTP), "
                "passkeys (WebAuthn), magic links, OAuth (Google / Microsoft / Apple / "
                "GitHub / LinkedIn via django-allauth), SAML 2.0 (djangosaml2), SCIM 2.0 "
                "(django-scim2-style), SimpleJWT (15min access / 30d refresh), "
                "django-axes throttling, django-guardian object permissions, audit log."
            ),
            "license": {"name": "Proprietary"},
        },
        "servers": [
            {"url": "/", "description": "Same-origin (relative)"},
        ],
        "tags": [
            {"name": "system"},
            {"name": "auth"},
            {"name": "2fa"},
            {"name": "webauthn"},
            {"name": "organizations"},
            {"name": "users"},
            {"name": "roles"},
            {"name": "audit"},
            {"name": "devices"},
            {"name": "api-keys"},
            {"name": "security"},
            {"name": "scim"},
            {"name": "saml"},
        ],
        "paths": _paths(),
        "components": {
            "securitySchemes": _security_schemes(),
            "schemas": {
                "User": _user_schema(),
                "Membership": _membership_schema(),
                "Organization": _organization_schema(),
                "Role": _role_schema(),
                "TokenPair": _token_pair_schema(),
                "Refresh": _refresh_schema(),
                "ApiKey": _api_key_schema(),
                "Device": _device_schema(),
                "AuditLog": _audit_log_schema(),
                "Error": _error_schema(),
            },
        },
        "security": [{"bearerAuth": []}],
    }


__all__ = ["get_openapi_schema"]

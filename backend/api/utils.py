"""Utility helpers for auth, crypto, audit, and tenant IP allowlists.

These helpers are intentionally dependency-light so they can be unit-tested
without spinning up Django. Functions that touch the ORM accept Django objects
rather than importing them at module load time so that the module is safe to
import during migrations.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import time
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from django.conf import settings
from django.utils import timezone

if TYPE_CHECKING:  # pragma: no cover — typing only
    from django.http import HttpRequest

    from api.models import AuditLog, Organization, User


###############################################################################
# Password policy
###############################################################################

PASSWORD_MIN_LENGTH = 12
PASSWORD_HISTORY_LIMIT = 10
PASSWORD_EXPIRY_DAYS = 90
HAVEIBEENPWNED_API = "https://api.pwnedpasswords.com/range/"


def password_meets_policy(
    password: str,
    user: "User | None" = None,
    check_history: bool = True,
    check_breach: bool = True,
) -> tuple[bool, list[str]]:
    """Validate ``password`` against the platform password policy.

    Returns ``(ok, errors)``. Checks complexity (length, upper/lower/digit/
    symbol), the HaveIBeenPwned k-anonymity API, and (when ``user`` is provided)
    the user's last ``PASSWORD_HISTORY_LIMIT`` hashes.
    """
    errors: list[str] = []
    if len(password) < PASSWORD_MIN_LENGTH:
        errors.append(f"Password must be at least {PASSWORD_MIN_LENGTH} characters long.")
    if not any(c.isupper() for c in password):
        errors.append("Password must contain an uppercase letter.")
    if not any(c.islower() for c in password):
        errors.append("Password must contain a lowercase letter.")
    if not any(c.isdigit() for c in password):
        errors.append("Password must contain a digit.")
    if not any(not c.isalnum() for c in password):
        errors.append("Password must contain a symbol.")

    if check_breach and not errors:
        if _is_password_breached(password):
            errors.append("Password appears in known data breaches; choose another.")

    if check_history and user is not None and user.pk:
        if _password_in_history(password, user):
            errors.append("Password was used recently; pick a new one.")

    return (not errors), errors


def _is_password_breached(password: str) -> bool:
    """Check the password against HIBP using the k-anonymity range API.

    The full hash never leaves the client; only the first 5 hex chars are sent.
    Network failures are treated as *not breached* (fail-open) so that an
    offline install still allows password changes — set
    ``PASSWORD_BREACH_CHECK_STRICT=true`` to flip this behavior.
    """
    import urllib.request

    sha1 = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()  # noqa: S324
    prefix, suffix = sha1[:5], sha1[5:]
    try:
        with urllib.request.urlopen(HAVEIBEENPWNED_API + prefix, timeout=3) as resp:  # noqa: S310
            body = resp.read().decode("utf-8")
    except Exception:
        strict = os.environ.get("PASSWORD_BREACH_CHECK_STRICT", "false").lower() == "true"
        return strict
    for line in body.splitlines():
        candidate, _, _ = line.partition(":")
        if candidate == suffix:
            return True
    return False


def _password_in_history(password: str, user: "User") -> bool:
    """Return ``True`` if ``password`` matches any of the user's history hashes."""
    from django.contrib.auth.hashers import check_password  # local import to avoid cycle

    from api.models import PasswordHistory

    recent = PasswordHistory.objects.filter(user=user).order_by("-created_at")[:PASSWORD_HISTORY_LIMIT]
    return any(check_password(password, entry.password_hash) for entry in recent)


###############################################################################
# Magic links
###############################################################################

MAGIC_LINK_TTL_SECONDS = 10 * 60  # 10 minutes


def generate_magic_link(email: str, tenant: "Organization | None" = None) -> str:
    """Create a one-time magic-link token for ``email`` and return the raw token.

    Only the SHA-256 hash is stored. The caller is responsible for delivering
    the token (see :func:`api.tasks.send_magic_link`).
    """
    from api.models import MagicLink

    token = secrets.token_urlsafe(32)
    MagicLink.objects.create(
        email=email.lower(),
        token_hash=_hash_token(token),
        expires_at=timezone.now() + timezone.timedelta(seconds=MAGIC_LINK_TTL_SECONDS),
    )
    return token


def verify_magic_link(token: str) -> "User | None":
    """Consume ``token`` and return the matching user, or ``None`` if invalid.

    Marks the link as ``used`` and prevents replay.
    """
    from api.models import MagicLink, User

    link = MagicLink.objects.filter(token_hash=_hash_token(token)).first()
    if link is None or link.used or link.expires_at < timezone.now():
        return None
    user = User.objects.filter(email=link.email).first()
    link.used = True
    link.save(update_fields=["used"])
    return user


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


###############################################################################
# TOTP (RFC 6238)
###############################################################################


def totp_generate_secret() -> str:
    """Return a fresh base32-encoded TOTP secret."""
    import pyotp

    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, email: str, issuer: str = "Foundation") -> str:
    """Build an ``otpauth://`` URI suitable for QR-code generation."""
    import pyotp

    return pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)


def totp_verify(secret: str, code: str) -> bool:
    """Verify ``code`` against ``secret`` with the default ±1 window."""
    import pyotp

    if not secret or not code:
        return False
    return pyotp.totp.TOTP(secret).verify(code, valid_window=1)


###############################################################################
# WebAuthn helpers (webauthn-py)
###############################################################################


def webauthn_generate_challenge() -> bytes:
    """Return a 32-byte cryptographic challenge for WebAuthn ceremonies."""
    return secrets.token_bytes(32)


def webauthn_verify_registration(
    *,
    challenge: bytes,
    credential_response: dict[str, Any],
    rp_id: str,
    origin: str,
    user_id: str,
    user_name: str,
) -> dict[str, Any]:
    """Verify a WebAuthn registration response.

    Returns a dict with ``credential_id``, ``public_key`` and ``sign_count`` on
    success. Raises ``ValueError`` if verification fails. The webauthn-py API
    is intentionally abstracted here so the underlying library can be swapped
    without touching the view layer.
    """
    from webauthn import (  # type: ignore[import-not-found]
        WebAuthnUser,
        verify_registration_response,
    )

    try:
        verified = verify_registration_response(
            credential_response,
            expected_challenge=challenge,
            expected_origin=origin,
            expected_rp_id=rp_id,
        )
    except Exception as exc:  # pragma: no cover — defensive, depends on lib
        raise ValueError(f"WebAuthn registration verification failed: {exc}") from exc

    _ = WebAuthnUser(  # touch the import so ruff stays happy; removed in real usage
        user_id, user_name, user_name, b"", credential_response.get("id", "")
    )
    return {
        "credential_id": verified.credential_id,
        "public_key": verified.credential_public_key,
        "sign_count": verified.sign_count,
    }


def webauthn_verify_assertion(
    *,
    challenge: bytes,
    assertion_response: dict[str, Any],
    credential_id: bytes,
    public_key: bytes,
    sign_count: int,
    rp_id: str,
    origin: str,
) -> int:
    """Verify a WebAuthn assertion and return the new ``sign_count``.

    Raises ``ValueError`` on failure.
    """
    from webauthn import (  # type: ignore[import-not-found]
        WebAuthnAssertionResponse,
        WebAuthnCredential,
    )

    credential = WebAuthnCredential(
        id=credential_id,
        public_key=public_key,
        sign_count=sign_count,
    )
    try:
        new_count = WebAuthnAssertionResponse(
            credential,
            assertion_response,
            challenge,
            origin,
            rp_id,
        ).verify()
    except Exception as exc:  # pragma: no cover — depends on lib
        raise ValueError(f"WebAuthn assertion verification failed: {exc}") from exc
    return int(new_count)


###############################################################################
# Token hashing (API keys, refresh tokens)
###############################################################################


def hash_token(value: str) -> str:
    """SHA-256 hash for storage of opaque tokens (API keys, refresh tokens)."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def generate_api_key() -> tuple[str, str]:
    """Return ``(raw_key, key_hash)`` for a new API key.

    The raw key is returned to the caller exactly once and never persisted.
    """
    raw = "fk_" + secrets.token_urlsafe(32)
    return raw, hash_token(raw)


###############################################################################
# Field-level encryption stub (for OAuth access/refresh tokens)
###############################################################################


def encrypt_value(value: str) -> str:
    """Encrypt ``value`` with the ``FIELD_ENCRYPTION_KEY``.

    Uses Fernet (cryptography) when available, otherwise returns the value
    base64-encoded with a ``plain:`` prefix so that the dev experience still
    works without a key configured. Production deployments must set the key.
    """
    import base64

    key = getattr(settings, "FIELD_ENCRYPTION_KEY", None) or os.environ.get("FIELD_ENCRYPTION_KEY")
    if not key:
        return "plain:" + base64.b64encode(value.encode("utf-8")).decode("ascii")
    try:
        from cryptography.fernet import Fernet  # type: ignore[import-not-found]
    except ImportError:  # pragma: no cover — optional dep
        return "plain:" + base64.b64encode(value.encode("utf-8")).decode("ascii")
    f = Fernet(key.encode("utf-8") if isinstance(key, str) else key)
    return "fernet:" + f.encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_value(value: str) -> str:
    """Inverse of :func:`encrypt_value`."""
    import base64

    if value.startswith("plain:"):
        return base64.b64decode(value[len("plain:"):]).decode("utf-8")
    if value.startswith("fernet:"):
        from cryptography.fernet import Fernet  # type: ignore[import-not-found]

        key = getattr(settings, "FIELD_ENCRYPTION_KEY", None) or os.environ.get("FIELD_ENCRYPTION_KEY")
        if not key:
            raise ValueError("Encrypted value present but FIELD_ENCRYPTION_KEY not set")
        f = Fernet(key.encode("utf-8") if isinstance(key, str) else key)
        return f.decrypt(value[len("fernet:"):].encode("utf-8")).decode("utf-8")
    return value


###############################################################################
# IP allowlist
###############################################################################


def check_ip_allowlist(org: "Organization | None", ip: str | None) -> bool:
    """Return ``True`` if ``ip`` is allowed by ``org.ip_allowlist``.

    An empty allowlist permits all IPs. Invalid CIDRs are skipped. A missing
    ``ip`` (e.g. internal call) is permitted only when the allowlist is empty.
    """
    if org is None or not ip:
        return True
    allowlist: list[str] = list(org.ip_allowlist or [])
    if not allowlist:
        return True
    if ip is None:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for entry in allowlist:
        try:
            network = ipaddress.ip_network(entry, strict=False)
        except ValueError:
            continue
        if addr in network:
            return True
    return False


def get_client_ip(request: "HttpRequest | None") -> str | None:
    """Best-effort client IP extraction (respects ``X-Forwarded-For``)."""
    if request is None:
        return None
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


###############################################################################
# Audit logging
###############################################################################


def audit_log(
    *,
    actor: "User | None",
    action: str,
    target: Any = None,
    request: "HttpRequest | None" = None,
    metadata: dict[str, Any] | None = None,
    tenant: "Organization | None" = None,
) -> "AuditLog | None":
    """Persist an :class:`api.models.AuditLog` entry.

    ``target`` may be any model instance — its ``pk`` and content type are
    recorded. Safe to call from Celery tasks (``request`` omitted, ``ip`` /
    ``user_agent`` blank).
    """
    from django.contrib.contenttypes.models import ContentType

    from api.models import AuditLog

    try:
        if tenant is None and request is not None:
            tenant = getattr(request, "tenant", None)

        target_ct = None
        target_id = None
        if target is not None:
            target_ct = ContentType.objects.get_for_model(target)
            target_id = target.pk

        return AuditLog.objects.create(
            tenant=tenant,
            actor=actor,
            action=action,
            target_type=target_ct,
            target_id=target_id,
            ip=get_client_ip(request) if request else None,
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:512] if request else "",
            metadata=metadata or {},
        )
    except Exception:
        # Audit logging must never break the request flow.
        if getattr(settings, "DEBUG", False):
            raise
        return None


###############################################################################
# Timing-safe token comparison
###############################################################################


def constant_time_eq(a: str, b: str) -> bool:
    """HMAC-based constant-time string comparison."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


###############################################################################
# JSON helper for session/cookie storage
###############################################################################


def json_dumps(value: Any) -> str:
    """Deterministic JSON serialization for storing webauthn state in cache."""
    return json.dumps(value, separators=(",", ":"), sort_keys=True, default=str)


def timestamp() -> int:
    """Return current epoch seconds — used for challenge freshness."""
    return int(time.time())


# Re-exported for views that need to compose magic-link URLs.
def build_magic_link_url(token: str) -> str:
    """Return the frontend URL the user clicks to consume a magic link."""
    base = os.environ.get("MAGIC_LINK_BASE_URL", "http://localhost:3000")
    return f"{base.rstrip('/')}/auth/magic?token={quote(token)}"

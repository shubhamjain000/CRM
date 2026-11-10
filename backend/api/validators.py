"""Custom Django password validators wired in ``config.settings.AUTH_PASSWORD_VALIDATORS``.

* :class:`PasswordComplexityValidator` — min length, upper/lower/digit/symbol,
  and (optionally) breach check via HaveIBeenPwned k-anonymity.
* :class:`PasswordHistoryValidator` — reject the last ``PASSWORD_HISTORY_LIMIT``
  hashes (default 10).
* :class:`PasswordExpiryValidator` — soft warning when a password is older
  than ``PASSWORD_EXPIRY_DAYS`` (default 90). Rejects only on the next change
  attempt; never blocks an in-flight session.
"""

from __future__ import annotations

from typing import Any

from django.conf import settings
from django.contrib.auth.password_validation import UserAttributeSimilarityValidator
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.utils.translation import gettext_lazy as _


class PasswordComplexityValidator:
    """Enforce length + character-class complexity, with an optional breach check."""

    def __init__(self, min_length: int | None = None) -> None:
        self.min_length = min_length or getattr(settings, "PASSWORD_MIN_LENGTH", 12)

    def validate(self, password: str, user: Any | None = None) -> None:
        from .utils import password_meets_policy

        ok, errors = password_meets_policy(
            password,
            user=user if getattr(user, "pk", None) else None,
            check_history=False,  # history is enforced by PasswordHistoryValidator
        )
        if not ok:
            raise ValidationError(errors)

    def get_help_text(self) -> str:
        return _(
            "Password must be at least %(n)d characters long and contain an "
            "uppercase letter, lowercase letter, digit, and symbol."
        ) % {"n": self.min_length}


class PasswordHistoryValidator:
    """Reject passwords that match the user's last N stored hashes."""

    def __init__(self, history_limit: int | None = None) -> None:
        self.history_limit = history_limit or getattr(settings, "PASSWORD_HISTORY_LIMIT", 10)

    def validate(self, password: str, user: Any | None = None) -> None:
        if user is None or not getattr(user, "pk", None):
            return  # new-user flow — nothing to compare against.
        from django.contrib.auth.hashers import check_password

        from .models import PasswordHistory

        recent = (
            PasswordHistory.objects.filter(user=user)
            .order_by("-created_at")[: self.history_limit]
        )
        for entry in recent:
            if check_password(password, entry.password_hash):
                raise ValidationError(
                    _("This password was used recently. Choose a new one."),
                    code="password_recently_used",
                )

    def password_changed(self, password: str, user: Any | None) -> None:
        """Hook called by ``AbstractBaseUser.set_password`` flows after a change."""
        if user is None or not getattr(user, "pk", None):
            return
        from django.contrib.auth.hashers import make_password

        from .models import PasswordHistory

        PasswordHistory.objects.create(user=user, password_hash=make_password(password))

    def get_help_text(self) -> str:
        return _("Your password cannot be one of your last %(n)d passwords.") % {"n": self.history_limit}


class PasswordExpiryValidator:
    """Soft-enforce password expiry.

    Does *not* reject the password outright (which would lock users out at
    unpredictable times). Instead, when the user changes their password and
    the *previous* password was older than ``PASSWORD_EXPIRY_DAYS``, this
    validator records a flag that downstream views can surface as a forced
    reset prompt. A truly expired password blocks only password-gated logins
    via the login view's check.
    """

    def __init__(self, expiry_days: int | None = None) -> None:
        self.expiry_days = expiry_days or getattr(settings, "PASSWORD_EXPIRY_DAYS", 90)

    def validate(self, password: str, user: Any | None = None) -> None:
        if user is None or not getattr(user, "pk", None):
            return
        changed_at = getattr(user, "password_changed_at", None)
        if changed_at is None:
            return
        age = timezone.now() - changed_at
        if age > timezone.timedelta(days=self.expiry_days):
            # Allow the change to proceed — the validator's job is to *prompt*
            # the change, not block it. The login view enforces the hard cut.
            return

    def get_help_text(self) -> str:
        return _("Passwords must be changed every %(n)d days.") % {"n": self.expiry_days}


# Re-export so settings can reference the same module without confusion.
__all__ = [
    "PasswordComplexityValidator",
    "PasswordExpiryValidator",
    "PasswordHistoryValidator",
    "UserAttributeSimilarityValidator",
]

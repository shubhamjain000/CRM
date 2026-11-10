"""Contact model — a person in the CRM."""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from accounts.models import Account
from api.models import User
from api.soft_delete import SoftDeleteTenantModel


class Contact(SoftDeleteTenantModel):
    """A person. Optionally linked to an :class:`accounts.Account`."""

    LEAD_SOURCE_WEB = "web"
    LEAD_SOURCE_PHONE = "phone"
    LEAD_SOURCE_REFERRAL = "referral"
    LEAD_SOURCE_EMAIL = "email"
    LEAD_SOURCE_EVENT = "event"
    LEAD_SOURCE_OTHER = "other"
    LEAD_SOURCE_CHOICES = [
        (LEAD_SOURCE_WEB, "Web"),
        (LEAD_SOURCE_PHONE, "Phone"),
        (LEAD_SOURCE_REFERRAL, "Referral"),
        (LEAD_SOURCE_EMAIL, "Email"),
        (LEAD_SOURCE_EVENT, "Event"),
        (LEAD_SOURCE_OTHER, "Other"),
    ]

    first_name = models.CharField(max_length=128)
    last_name = models.CharField(max_length=128, blank=True, default="")
    account = models.ForeignKey(
        Account,
        on_delete=models.RESTRICT,
        null=True,
        blank=True,
        related_name="contacts",
        db_index=True,
    )
    title = models.CharField(max_length=128, blank=True, default="")
    emails = models.JSONField(default=list, blank=True)
    phones = models.JSONField(default=list, blank=True)
    addresses = models.JSONField(default=list, blank=True)
    social_profiles = models.JSONField(default=dict, blank=True)
    birthday = models.DateField(null=True, blank=True)
    department = models.CharField(max_length=128, blank=True, default="")
    assistant = models.CharField(max_length=128, blank=True, default="")
    lead_source = models.CharField(max_length=32, choices=LEAD_SOURCE_CHOICES, blank=True, default="")
    owner = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="owned_contacts",
    )
    do_not_call = models.BooleanField(default=False)
    email_opt_out = models.BooleanField(default=False)
    description = models.TextField(blank=True, default="")
    last_activity = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "contacts_contact"
        verbose_name = "contact"
        verbose_name_plural = "contacts"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(lead_source__in=(
                    "", "web", "phone", "referral", "email", "event", "other",
                )),
                name="contacts_lead_source_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "deleted_at"], name="contacts_tenant_deleted_idx"),
            models.Index(fields=["tenant", "account"], name="contacts_tenant_account_idx"),
            models.Index(fields=["tenant", "owner"], name="contacts_tenant_owner_idx"),
        ]

    def __str__(self) -> str:
        return " ".join(part for part in (self.first_name, self.last_name) if part) or "Contact"

    @property
    def full_name(self) -> str:
        return str(self)

    def primary_email(self) -> str:
        if not self.emails:
            return ""
        first = self.emails[0]
        if isinstance(first, dict):
            return str(first.get("email", ""))
        return str(first)

    def touch(self) -> None:
        """Bump ``last_activity`` to now."""
        self.last_activity = timezone.now()
        self.save(update_fields=["last_activity", "updated_at"])

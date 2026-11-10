"""Lead model — a prospect, not yet converted into a contact/account/deal."""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from accounts.models import Account
from api.models import User
from api.soft_delete import SoftDeleteTenantModel
from contacts.models import Contact


class Lead(SoftDeleteTenantModel):
    """A sales lead.

    Once qualified, ``convert_lead`` creates an :class:`accounts.Account`,
    :class:`contacts.Contact`, and (optionally) :class:`deals.Deal`, then sets
    ``is_converted=True`` and stores the FKs in ``converted_account`` /
    ``converted_contact`` / ``converted_deal``.
    """

    STATUS_NEW = "new"
    STATUS_CONTACTED = "contacted"
    STATUS_QUALIFIED = "qualified"
    STATUS_UNQUALIFIED = "unqualified"
    STATUS_CONVERTED = "converted"
    STATUS_CHOICES = [
        (STATUS_NEW, "New"),
        (STATUS_CONTACTED, "Contacted"),
        (STATUS_QUALIFIED, "Qualified"),
        (STATUS_UNQUALIFIED, "Unqualified"),
        (STATUS_CONVERTED, "Converted"),
    ]

    RATING_HOT = "hot"
    RATING_WARM = "warm"
    RATING_COLD = "cold"
    RATING_CHOICES = [
        (RATING_HOT, "Hot"),
        (RATING_WARM, "Warm"),
        (RATING_COLD, "Cold"),
    ]

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
    company = models.CharField(max_length=255, blank=True, default="")
    title = models.CharField(max_length=128, blank=True, default="")
    emails = models.JSONField(default=list, blank=True)
    phones = models.JSONField(default=list, blank=True)
    lead_source = models.CharField(max_length=32, choices=LEAD_SOURCE_CHOICES, blank=True, default="")
    lead_status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_NEW, db_index=True)
    rating = models.CharField(max_length=16, choices=RATING_CHOICES, blank=True, default="")
    industry = models.CharField(max_length=128, blank=True, default="")
    annual_revenue = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    employees = models.PositiveIntegerField(null=True, blank=True)
    website = models.URLField(blank=True, default="")
    billing_address = models.JSONField(default=dict, blank=True)
    shipping_address = models.JSONField(default=dict, blank=True)
    description = models.TextField(blank=True, default="")

    owner = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="owned_leads",
    )
    assigned_to = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_leads",
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_leads",
    )
    last_activity = models.DateTimeField(null=True, blank=True)
    score = models.FloatField(default=0.0, help_text="AI-computed lead score 0-100.")
    is_converted = models.BooleanField(default=False)

    converted_account = models.ForeignKey(
        Account,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="converted_leads",
    )
    converted_contact = models.ForeignKey(
        Contact,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="converted_leads",
    )
    converted_deal = models.ForeignKey(
        "deals.Deal",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="converted_leads",
    )

    class Meta:
        db_table = "leads_lead"
        verbose_name = "lead"
        verbose_name_plural = "leads"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(lead_status__in=(
                    "new", "contacted", "qualified", "unqualified", "converted",
                )),
                name="leads_lead_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(rating__in=("hot", "warm", "cold", "")),
                name="leads_rating_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(score__gte=0.0) & models.Q(score__lte=100.0),
                name="leads_score_range",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "deleted_at"], name="leads_tenant_deleted_idx"),
            models.Index(fields=["tenant", "lead_status", "owner"], name="leads_status_owner_idx"),
            models.Index(fields=["tenant", "owner", "created_at"], name="leads_owner_created_idx"),
            models.Index(fields=["tenant", "last_activity"], name="leads_last_activity_idx"),
        ]

    def __str__(self) -> str:
        return " ".join(p for p in (self.first_name, self.last_name) if p) or self.company or "Lead"

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

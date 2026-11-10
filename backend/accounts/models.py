"""Account model — an organization a business sells to."""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import User
from api.soft_delete import SoftDeleteTenantModel


class Account(SoftDeleteTenantModel):
    """A company / organization in the CRM.

    Supports a self-referential ``parent_account`` for corporate hierarchies
    (subsidiaries, divisions). Tenant-scoped and soft-deletable.
    """

    TYPE_CUSTOMER = "customer"
    TYPE_PROSPECT = "prospect"
    TYPE_PARTNER = "partner"
    TYPE_COMPETITOR = "competitor"
    TYPE_VENDOR = "vendor"
    TYPE_CHOICES = [
        (TYPE_CUSTOMER, "Customer"),
        (TYPE_PROSPECT, "Prospect"),
        (TYPE_PARTNER, "Partner"),
        (TYPE_COMPETITOR, "Competitor"),
        (TYPE_VENDOR, "Vendor"),
    ]

    RATING_HOT = "hot"
    RATING_WARM = "warm"
    RATING_COLD = "cold"
    RATING_CHOICES = [
        (RATING_HOT, "Hot"),
        (RATING_WARM, "Warm"),
        (RATING_COLD, "Cold"),
    ]

    name = models.CharField(max_length=255, db_index=True)
    account_number = models.CharField(max_length=64, blank=True, default="")
    account_type = models.CharField(max_length=32, choices=TYPE_CHOICES, default=TYPE_CUSTOMER, db_index=True)
    industry = models.CharField(max_length=128, blank=True, default="")
    annual_revenue = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    employees = models.PositiveIntegerField(null=True, blank=True)
    website = models.URLField(blank=True, default="")
    billing_address = models.JSONField(default=dict, blank=True)
    shipping_address = models.JSONField(default=dict, blank=True)
    parent_account = models.ForeignKey(
        "self",
        on_delete=models.RESTRICT,
        null=True,
        blank=True,
        related_name="children",
        db_index=True,
    )
    ticker_symbol = models.CharField(max_length=16, blank=True, default="")
    ownership = models.CharField(max_length=64, blank=True, default="")
    rating = models.CharField(max_length=16, choices=RATING_CHOICES, blank=True, default="")
    sic_code = models.CharField(max_length=16, blank=True, default="")
    description = models.TextField(blank=True, default="")
    tags = models.JSONField(default=list, blank=True)
    owner = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="owned_accounts",
    )
    last_activity = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "accounts_account"
        verbose_name = "account"
        verbose_name_plural = "accounts"
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(account_type__in=("customer", "prospect", "partner", "competitor", "vendor"))
                ),
                name="accounts_account_type_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(rating__in=("hot", "warm", "cold", "")),
                name="accounts_rating_valid",
            ),
            models.UniqueConstraint(
                fields=["tenant", "account_number"],
                name="accounts_unique_number_per_tenant",
                condition=models.Q(account_number__gt=""),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "deleted_at"], name="accounts_tenant_deleted_idx"),
            models.Index(fields=["tenant", "owner"], name="accounts_tenant_owner_idx"),
            models.Index(fields=["tenant", "account_type"], name="accounts_tenant_type_idx"),
            models.Index(fields=["tenant", "parent_account"], name="accounts_tenant_parent_idx"),
        ]

    def __str__(self) -> str:
        return self.name

    # ------------------------------------------------------------------ helpers

    def touch(self) -> None:
        """Bump ``last_activity`` to now."""
        self.last_activity = timezone.now()
        self.save(update_fields=["last_activity", "updated_at"])

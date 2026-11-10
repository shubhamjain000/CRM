"""``seed_crm`` management command.

Creates a demo org, admin user, default pipeline + 6 stages, and CRM records
(30 accounts, 50 contacts, 100 leads, 20 deals). Idempotent — re-running
prints a summary and skips creation when data already exists.

Usage::

    python manage.py seed_crm
    python manage.py seed_crm --reset   # delete demo data first
"""

from __future__ import annotations

import random
from decimal import Decimal
from typing import Any

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import Account
from api.managers import tenant_context
from api.models import Organization, Role, TenantMembership, User
from contacts.models import Contact
from deals.models import Deal
from deals.models_pipeline import Pipeline, Stage
from leads.models import Lead

DEFAULT_ORG_SUBDOMAIN = "demo"
DEFAULT_ORG_SLUG = "demo"
DEFAULT_ORG_NAME = "Demo Org"
DEFAULT_ADMIN_EMAIL = "admin@demo.local"
DEFAULT_ADMIN_PASSWORD = "DemoAdmin123!"  # noqa: S105 — demo only

# Default Sales Pipeline + 6 stages. Phase 8 adds forecast_category, is_locked
# (terminal stages), business_days_limit (Negotiation warns at 14 business
# days), and a hex color so the seeded pipeline renders well in the UI.
DEFAULT_PIPELINE_NAME = "Sales Pipeline"
DEFAULT_STAGES: list[dict[str, Any]] = [
    {
        "name": "Prospect",
        "probability": 10.0,
        "order": 0,
        "forecast_category": "pipeline",
        "color": "#94a3b8",
        "icon": "filter",
    },
    {
        "name": "Qualified",
        "probability": 25.0,
        "order": 1,
        "forecast_category": "pipeline",
        "color": "#3b82f6",
        "icon": "check-circle",
    },
    {
        "name": "Proposal",
        "probability": 50.0,
        "order": 2,
        "forecast_category": "best_case",
        "color": "#8b5cf6",
        "icon": "file-text",
    },
    {
        "name": "Negotiation",
        "probability": 75.0,
        "order": 3,
        "forecast_category": "commit",
        "color": "#f59e0b",
        "icon": "handshake",
        "business_days_limit": 14,
    },
    {
        "name": "Closed Won",
        "probability": 100.0,
        "order": 4,
        "is_won_stage": True,
        "forecast_category": "closed",
        "is_locked": True,
        "color": "#22c55e",
        "icon": "trophy",
    },
    {
        "name": "Closed Lost",
        "probability": 0.0,
        "order": 5,
        "is_lost_stage": True,
        "forecast_category": "omitted",
        "is_locked": True,
        "color": "#ef4444",
        "icon": "x-circle",
    },
]

ACCOUNTS_TO_CREATE = 30
CONTACTS_TO_CREATE = 50
LEADS_TO_CREATE = 100
DEALS_TO_CREATE = 20

INDUSTRIES = ["Technology", "Healthcare", "Finance", "Manufacturing", "Retail", "Education"]
ACCOUNT_TYPES = ["customer", "prospect", "partner", "vendor"]
RATINGS = ["hot", "warm", "cold"]
LEAD_STATUSES = ["new", "contacted", "qualified", "unqualified"]
LEAD_SOURCES = ["web", "phone", "referral", "email", "event", "other"]
FIRST_NAMES = ["Ada", "Alan", "Grace", "Linus", "Margaret", "Katherine", "Donald", "Edsger"]
LAST_NAMES = ["Lovelace", "Turing", "Hopper", "Torvalds", "Hamilton", "Johnson", "Knuth", "Dijkstra"]


class Command(BaseCommand):
    """Seed the CRM demo dataset."""

    help = "Seed demo org, admin user, default pipeline, and CRM records."

    def add_arguments(self, parser: Any) -> None:  # type: ignore[override]
        parser.add_argument("--reset", action="store_true", help="Delete existing demo data first.")
        parser.add_argument("--org", default=DEFAULT_ORG_NAME, help="Demo organization name.")
        parser.add_argument("--admin-email", default=DEFAULT_ADMIN_EMAIL, help="Admin user email.")
        parser.add_argument(
            "--admin-password",
            default=DEFAULT_ADMIN_PASSWORD,
            help="Admin user password (demo only).",
        )

    def handle(self, *args: Any, **options: Any) -> None:  # type: ignore[override]
        reset = bool(options.get("reset"))
        org_name = options.get("org") or DEFAULT_ORG_NAME
        admin_email = options.get("admin_email") or DEFAULT_ADMIN_EMAIL
        admin_password = options.get("admin_password") or DEFAULT_ADMIN_PASSWORD

        if reset:
            self._reset()

        with transaction.atomic():
            org = self._ensure_org(org_name)
            admin = self._ensure_admin(org, admin_email, admin_password)
            pipeline, stages = self._ensure_pipeline(org)
            accounts = self._seed_accounts(org, admin)
            contacts = self._seed_contacts(org, admin, accounts)
            self._seed_leads(org, admin)
            self._seed_deals(org, admin, accounts, contacts, pipeline, stages)

        self.stdout.write(self.style.SUCCESS("✓ Seed complete."))
        self.stdout.write(self.style.SUCCESS("Summary:"))
        self.stdout.write(self.style.SUCCESS(f"  Org: {org.name} (subdomain={org.subdomain})"))
        self.stdout.write(self.style.SUCCESS(f"  Admin: {admin.email}"))
        self.stdout.write(self.style.SUCCESS(f"  Pipeline: {pipeline.name} ({len(stages)} stages)"))
        self.stdout.write(self.style.SUCCESS(f"  Accounts: {Account.objects.filter(tenant=org).count()}"))
        self.stdout.write(self.style.SUCCESS(f"  Contacts: {Contact.objects.filter(tenant=org).count()}"))
        self.stdout.write(self.style.SUCCESS(f"  Leads:    {Lead.objects.filter(tenant=org).count()}"))
        self.stdout.write(self.style.SUCCESS(f"  Deals:    {Deal.objects.filter(tenant=org).count()}"))

    # ------------------------------------------------------------------ helpers

    def _reset(self) -> None:
        """Delete existing demo data (org + cascade deletes everything under it)."""
        self.stdout.write(self.style.WARNING("Reset: deleting demo data..."))
        Organization.objects.filter(subdomain=DEFAULT_ORG_SUBDOMAIN).delete()
        User.objects.filter(email=DEFAULT_ADMIN_EMAIL).delete()

    def _ensure_org(self, name: str) -> Organization:
        org, created = Organization.objects.get_or_create(
            subdomain=DEFAULT_ORG_SUBDOMAIN,
            defaults={"slug": DEFAULT_ORG_SLUG, "name": name, "is_active": True, "plan": "enterprise"},
        )
        if not created:
            self.stdout.write(f"Org already exists: {org.name}")
        return org

    def _ensure_admin(self, org: Organization, email: str, password: str) -> User:
        user, created = User.objects.get_or_create(
            email=email,
            defaults={
                "name": "Demo Admin",
                "is_active_account": True,
                "is_staff": True,
                "is_superuser": True,
                "password": make_password(password),
            },
        )
        # Ensure admin role + membership.
        role, _ = Role.objects.get_or_create(
            tenant=org,
            name="Owner",
            defaults={"permissions": ["org.admin"], "is_system": True},
        )
        TenantMembership.objects.get_or_create(
            user=user,
            tenant=org,
            defaults={"role": role, "is_active": True},
        )
        if created:
            self.stdout.write(f"Admin user created: {user.email}")
        else:
            self.stdout.write(f"Admin user already exists: {user.email}")
        return user

    def _ensure_pipeline(self, org: Organization) -> tuple[Pipeline, list[Stage]]:
        with tenant_context(org):
            pipeline, created = Pipeline.objects.get_or_create(
                tenant=org,
                name=DEFAULT_PIPELINE_NAME,
                defaults={"is_default": True},
            )
            stages: list[Stage] = []
            for spec in DEFAULT_STAGES:
                stage, _ = Stage.objects.get_or_create(
                    tenant=org,
                    pipeline=pipeline,
                    name=spec["name"],
                    defaults={
                        "probability": spec["probability"],
                        "order": spec["order"],
                        "is_won_stage": spec.get("is_won_stage", False),
                        "is_lost_stage": spec.get("is_lost_stage", False),
                        "forecast_category": spec.get("forecast_category", "pipeline"),
                        "is_locked": spec.get("is_locked", False),
                        "business_days_limit": spec.get("business_days_limit"),
                        "color": spec.get("color", "#3b82f6"),
                        "icon": spec.get("icon", ""),
                    },
                )
                stages.append(stage)
            if created:
                self.stdout.write(f"Pipeline created: {pipeline.name} ({len(stages)} stages)")
            else:
                self.stdout.write(f"Pipeline already exists: {pipeline.name}")
        return pipeline, stages

    def _seed_accounts(self, org: Organization, admin: User) -> list[Account]:
        with tenant_context(org):
            existing = Account.objects.count()
            if existing >= ACCOUNTS_TO_CREATE:
                self.stdout.write(f"Accounts already seeded ({existing}); skipping.")
                return list(Account.objects.all()[:ACCOUNTS_TO_CREATE])
            accounts: list[Account] = []
            for i in range(ACCOUNTS_TO_CREATE - existing):
                acct = Account.objects.create(
                    tenant=org,
                    name=f"Account {existing + i + 1}",
                    account_number=f"ACC-{existing + i + 1:05d}",
                    account_type=random.choice(ACCOUNT_TYPES),
                    industry=random.choice(INDUSTRIES),
                    annual_revenue=Decimal(random.randint(10_000, 10_000_000)),
                    employees=random.randint(1, 5000),
                    website=f"https://account{existing + i + 1}.example.com",
                    billing_address={"city": "SF", "country": "US"},
                    rating=random.choice(RATINGS),
                    owner=admin,
                )
                accounts.append(acct)
        self.stdout.write(f"Seeded {len(accounts)} new accounts.")
        return accounts

    def _seed_contacts(
        self, org: Organization, admin: User, accounts: list[Account]
    ) -> list[Contact]:
        with tenant_context(org):
            existing = Contact.objects.count()
            if existing >= CONTACTS_TO_CREATE:
                self.stdout.write(f"Contacts already seeded ({existing}); skipping.")
                return list(Contact.objects.all()[:CONTACTS_TO_CREATE])
            contacts: list[Contact] = []
            for i in range(CONTACTS_TO_CREATE - existing):
                first = random.choice(FIRST_NAMES)
                last = random.choice(LAST_NAMES)
                contact = Contact.objects.create(
                    tenant=org,
                    first_name=first,
                    last_name=last,
                    account=random.choice(accounts) if accounts else None,
                    title="Director",
                    emails=[{"email": f"{first.lower()}.{last.lower()}@example.com", "type": "work"}],
                    phones=[{"phone": f"+1555555{random.randint(10000, 99999)}", "type": "work"}],
                    lead_source=random.choice(LEAD_SOURCES),
                    owner=admin,
                )
                contacts.append(contact)
        self.stdout.write(f"Seeded {len(contacts)} new contacts.")
        return contacts

    def _seed_leads(self, org: Organization, admin: User) -> None:
        with tenant_context(org):
            existing = Lead.objects.count()
            if existing >= LEADS_TO_CREATE:
                self.stdout.write(f"Leads already seeded ({existing}); skipping.")
                return
            for i in range(LEADS_TO_CREATE - existing):
                first = random.choice(FIRST_NAMES)
                last = random.choice(LAST_NAMES)
                Lead.objects.create(
                    tenant=org,
                    first_name=first,
                    last_name=last,
                    company=f"{last} Industries",
                    title="VP Engineering",
                    emails=[{"email": f"{first.lower()}.{last.lower()}{i}@example.com", "type": "work"}],
                    phones=[{"phone": f"+1555555{random.randint(10000, 99999)}", "type": "work"}],
                    lead_source=random.choice(LEAD_SOURCES),
                    lead_status=random.choice(LEAD_STATUSES),
                    rating=random.choice(RATINGS),
                    industry=random.choice(INDUSTRIES),
                    annual_revenue=Decimal(random.randint(10_000, 5_000_000)),
                    employees=random.randint(1, 2000),
                    website=f"https://{last.lower()}{i}.example.com",
                    billing_address={"city": "NYC", "country": "US"},
                    owner=admin,
                    created_by=admin,
                    score=random.randint(0, 100),
                )
        self.stdout.write(f"Seeded {LEADS_TO_CREATE - existing} new leads.")

    def _seed_deals(
        self,
        org: Organization,
        admin: User,
        accounts: list[Account],
        contacts: list[Contact],
        pipeline: Pipeline,
        stages: list[Stage],
    ) -> None:
        with tenant_context(org):
            existing = Deal.objects.count()
            if existing >= DEALS_TO_CREATE:
                self.stdout.write(f"Deals already seeded ({existing}); skipping.")
                return
            open_stages = [s for s in stages if not s.is_won_stage and not s.is_lost_stage]
            for i in range(DEALS_TO_CREATE - existing):
                account = random.choice(accounts) if accounts else None
                contact = random.choice(contacts) if contacts else None
                stage = random.choice(open_stages) if open_stages else stages[0]
                Deal.objects.create(
                    tenant=org,
                    name=f"Deal {existing + i + 1}",
                    amount=Decimal(random.randint(1_000, 500_000)),
                    currency="USD",
                    stage=stage,
                    pipeline=pipeline,
                    close_date=None,
                    probability=stage.probability,
                    forecast_category=stage.forecast_category,
                    account=account,
                    primary_contact=contact,
                    owner=admin,
                    lead_source=random.choice(LEAD_SOURCES),
                    type="new_business",
                )
        self.stdout.write(f"Seeded {DEALS_TO_CREATE - existing} new deals.")

"""``cleanup_trash`` management command.

Permanently deletes CRM records that were soft-deleted more than
:data:`RETENTION_DAYS` days ago. Sweeps all four CRM modules across every
active tenant.

Usage::

    python manage.py cleanup_trash
    python manage.py cleanup_trash --days 30    # override retention window
    python manage.py cleanup_trash --dry-run    # report without deleting

Wired as a daily Celery beat task at 02:00 UTC (see ``config/settings.py``
``CELERY_BEAT_SCHEDULE`` entry ``crm-ux-cleanup-trash``).
"""

from __future__ import annotations

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from api.managers import tenant_context
from api.models import Organization
from crm_ux.services import ALL_MODULES, resolve_module_model

#: Default retention — soft-deleted rows older than this are purged.
RETENTION_DAYS = 30


class Command(BaseCommand):
    """Permanently delete CRM records soft-deleted > ``--days`` ago."""

    help = (
        "Permanently delete CRM records (leads/contacts/accounts/deals) that "
        "were soft-deleted more than --days ago (default 30)."
    )

    def add_arguments(self, parser) -> None:  # type: ignore[override]
        parser.add_argument(
            "--days",
            type=int,
            default=RETENTION_DAYS,
            help=f"Retention window in days (default: {RETENTION_DAYS}).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print the summary without actually deleting anything.",
        )

    def handle(self, *args, **options) -> None:  # type: ignore[override]
        days: int = options["days"]
        dry_run: bool = options["dry_run"]
        cutoff = timezone.now() - timedelta(days=days)

        self.stdout.write(
            self.style.WARNING(
                f"cleanup_trash: purging rows soft-deleted before {cutoff.isoformat()} "
                f"(retention={days}d, dry_run={dry_run})"
            )
        )

        total_per_module: dict[str, int] = {module: 0 for module in ALL_MODULES}
        tenants_processed = 0

        for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
            with tenant_context(org):
                tenants_processed += 1
                for module in ALL_MODULES:
                    model = resolve_module_model(module)
                    qs = model.all_objects.filter(
                        tenant=org,
                        deleted_at__isnull=False,
                        deleted_at__lt=cutoff,
                    )
                    count = qs.count()
                    if count == 0:
                        continue
                    if not dry_run:
                        deleted, _ = qs.delete()
                        total_per_module[module] += deleted
                    else:
                        total_per_module[module] += count
                    self.stdout.write(
                        f"  org={org.slug} module={module} candidates={count}"
                    )

        self.stdout.write(self.style.SUCCESS("cleanup_trash: summary"))
        self.stdout.write(f"  tenants_processed: {tenants_processed}")
        for module, count in total_per_module.items():
            self.stdout.write(f"  {module}: {count} purged")
        self.stdout.write(
            self.style.SUCCESS("cleanup_trash: done" + (" (dry-run)" if dry_run else ""))
        )

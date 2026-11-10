"""Management command that enables PostgreSQL RLS on every tenant-scoped table.

Usage::

    python manage.py setup_rls
    python manage.py setup_rls --disable   # rollback (used by tests)

The command is idempotent and safe to run after each migration.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from api.rls import disable_rls, setup_all_rls, tenant_scoped_tables


class Command(BaseCommand):
    """Enable / disable PostgreSQL Row-Level Security on tenant tables."""

    help = "Enable (or disable with --disable) Row-Level Security on every TenantModel table."

    def add_arguments(self, parser) -> None:  # type: ignore[override]
        parser.add_argument(
            "--disable",
            action="store_true",
            help="Disable RLS instead of enabling it (used by tests / rollbacks).",
        )
        parser.add_argument(
            "--list",
            action="store_true",
            help="List the tenant-scoped tables that would be affected and exit.",
        )

    def handle(self, *args, **options) -> None:  # type: ignore[override]
        tables = tenant_scoped_tables()
        if not tables:
            self.stdout.write(self.style.WARNING("No tenant-scoped tables found."))
            return

        if options.get("list"):
            for table in tables:
                self.stdout.write(table)
            return

        if options.get("disable"):
            for table in tables:
                try:
                    disable_rls(table)
                    self.stdout.write(self.style.WARNING(f"RLS disabled on {table}"))
                except Exception as exc:
                    raise CommandError(f"Failed to disable RLS on {table}: {exc}") from exc
            return

        affected = setup_all_rls()
        for table in affected:
            self.stdout.write(self.style.SUCCESS(f"RLS enabled on {table}"))
        self.stdout.write(
            self.style.SUCCESS(f"Done. {len(affected)} tenant table(s) protected by RLS.")
        )

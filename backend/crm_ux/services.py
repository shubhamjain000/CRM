"""Service layer for the CRM UX app.

These functions are the canonical interface used by the viewsets, the signal
handlers, and (transitively) the Celery ``cleanup_trash`` task. They keep the
viewsets thin and make the business logic testable without an HTTP layer.
"""

from __future__ import annotations

import re
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from django.apps import apps
from django.utils import timezone

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User


###############################################################################
# Module → model resolution
###############################################################################


#: CRM module string → dotted ``app_label.ModelName``. Mirrors the mapping in
#: ``custom_fields/services.py`` so trash / signal / mention helpers can share.
_MODULE_MODEL_PATHS: dict[str, str] = {
    "lead": "leads.models.Lead",
    "contact": "contacts.models.Contact",
    "account": "accounts.models.Account",
    "deal": "deals.models.Deal",
}

#: All CRM modules — iteration order is stable.
ALL_MODULES: tuple[str, ...] = tuple(_MODULE_MODEL_PATHS.keys())


def resolve_module_model(module: str) -> type:
    """Return the Django model class for a CRM ``module`` string.

    Raises :class:`ValueError` for unknown modules.
    """
    path = _MODULE_MODEL_PATHS.get(module)
    if path is None:
        raise ValueError(f"Unknown CRM module: {module!r}")
    app_label, model_name = path.rsplit(".", 1)
    return apps.get_model(app_label, model_name)


def _record_name(instance: Any) -> str:
    """Best-effort display name for a CRM record."""
    name = getattr(instance, "name", None)
    if not name:
        name = getattr(instance, "full_name", None)
    if not name:
        name = str(instance)
    return str(name)


def _actor_for(instance: Any) -> "User | None":
    """Best-effort actor lookup for a CRM record (``created_by`` → ``owner``)."""
    actor = getattr(instance, "created_by", None) or getattr(instance, "owner", None)
    return actor


###############################################################################
# Activity log + view tracking
###############################################################################


def log_activity(
    *,
    tenant: "Organization",
    user: "User | None",
    module: str,
    record_id: str,
    record_name: str,
    action: str,
    description: str = "",
    metadata: dict[str, Any] | None = None,
) -> Any:
    """Create an :class:`crm_ux.models.Activity` row.

    Used directly by viewsets (note_added / file_attached / emailed / called /
    meeting / converted) and by the signal handlers (created / updated /
    deleted / restored). ``user`` may be ``None`` for system-initiated events.
    """
    from .models import Activity

    return Activity.objects.create(
        tenant=tenant,
        user=user,
        module=module,
        record_id=str(record_id),
        record_name=record_name[:255] if record_name else "",
        action=action,
        description=description or "",
        metadata=metadata or {},
    )


def track_view(
    *,
    tenant: "Organization",
    user: "User",
    module: str,
    record_id: str,
) -> Any:
    """Upsert a :class:`crm_ux.models.RecentlyViewed` row.

    If a row for (tenant, user, module, record_id) already exists, its
    ``viewed_at`` is bumped to ``now``; otherwise a new row is created. The
    return value is the upserted row.
    """
    from .models import RecentlyViewed

    obj, _created = RecentlyViewed.objects.update_or_create(
        tenant=tenant,
        user=user,
        module=module,
        record_id=str(record_id),
        defaults={"viewed_at": timezone.now()},
    )
    return obj


###############################################################################
# Timeline (activities + notes merged, grouped by date bucket)
###############################################################################


def get_timeline(
    *,
    tenant: "Organization",
    module: str,
    record_id: str,
) -> dict[str, list[dict[str, Any]]]:
    """Return the merged activity + note timeline for a record.

    The timeline is grouped into four ordered buckets:

    * ``Today`` — events since 00:00 today.
    * ``Yesterday`` — events since 00:00 yesterday.
    * ``This Week`` — events in the past 7 days (excluding today/yesterday).
    * ``Earlier`` — everything else.

    Each item is a dict with a ``type`` discriminator (``"activity"`` or
    ``"note"``) so the frontend can render the right card.
    """
    from .models import Activity, Note

    rid = str(record_id)
    activities = list(
        Activity.objects.filter(tenant=tenant, module=module, record_id=rid).order_by("-created_at")
    )
    notes = list(
        Note.objects.filter(tenant=tenant, module=module, record_id=rid).order_by("-created_at")
    )

    items: list[dict[str, Any]] = []
    for a in activities:
        items.append(
            {
                "type": "activity",
                "id": a.pk,
                "action": a.action,
                "description": a.description,
                "user_id": a.user_id,
                "record_name": a.record_name,
                "created_at": a.created_at,
                "metadata": a.metadata,
            }
        )
    for n in notes:
        items.append(
            {
                "type": "note",
                "id": n.pk,
                "body": n.body,
                "user_id": n.user_id,
                "created_at": n.created_at,
                "mentions": n.mentions,
                "hashtags": n.hashtags,
            }
        )

    # Stable sort by created_at desc.
    items.sort(key=lambda item: item["created_at"], reverse=True)

    now = timezone.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)
    week_start = today_start - timedelta(days=7)

    buckets: dict[str, list[dict[str, Any]]] = {
        "Today": [],
        "Yesterday": [],
        "This Week": [],
        "Earlier": [],
    }
    for item in items:
        ct = item["created_at"]
        if ct >= today_start:
            buckets["Today"].append(item)
        elif ct >= yesterday_start:
            buckets["Yesterday"].append(item)
        elif ct >= week_start:
            buckets["This Week"].append(item)
        else:
            buckets["Earlier"].append(item)
    return buckets


###############################################################################
# Mention + hashtag parsing
###############################################################################


#: Matches ``@<email>`` or ``@<numeric_user_id>`` tokens.
_MENTION_RE = re.compile(r"@(?P<token>[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\d+)")
#: Matches ``#hashtag`` tokens (letters, digits, underscore, hyphen).
_HASHTAG_RE = re.compile(r"#(?P<tag>[A-Za-z0-9_-]+)")


def parse_mentions_and_hashtags(
    text: str,
    *,
    tenant: "Organization | None" = None,
) -> dict[str, list[Any]]:
    """Extract ``@mentions`` and ``#hashtags`` from ``text``.

    Returns ``{"mentions": [...], "hashtags": [...]}``.

    Mention resolution rules:

    * Numeric ``@123`` tokens are kept as integers (assumed to be user IDs).
    * ``@email`` tokens are resolved to user IDs via :class:`TenantMembership`
      when ``tenant`` is provided; unresolved emails are dropped.

    Hashtags are returned lowercased, de-duplicated, and sorted for stable
    storage. The returned mentions list is also de-duplicated (preserving
    first-seen order).
    """
    if not text:
        return {"mentions": [], "hashtags": []}

    raw_mentions = _MENTION_RE.findall(text)
    hashtags = sorted({tag.lower() for tag in _HASHTAG_RE.findall(text)})

    mentions: list[Any] = []
    for token in raw_mentions:
        if token.isdigit():
            mentions.append(int(token))
        elif tenant is not None:
            user_id = _resolve_user_id_by_email(token, tenant)
            if user_id is not None:
                mentions.append(user_id)

    # De-duplicate preserving order.
    seen: set[Any] = set()
    deduped: list[Any] = []
    for value in mentions:
        if value not in seen:
            seen.add(value)
            deduped.append(value)
    return {"mentions": deduped, "hashtags": hashtags}


def _resolve_user_id_by_email(email: str, tenant: "Organization") -> int | None:
    """Resolve ``email`` to a user ID active in ``tenant`` (case-insensitive)."""
    from api.models import TenantMembership, User

    return (
        User.objects.filter(
            email__iexact=email,
            memberships__tenant=tenant,
            memberships__is_active=True,
        )
        .values_list("pk", flat=True)
        .first()
    )


###############################################################################
# Trash (soft-deleted CRM records)
###############################################################################


def _trash_record_to_dict(instance: Any, module: str) -> dict[str, Any]:
    """Serialize a soft-deleted CRM record to a trash-item dict."""
    owner = getattr(instance, "owner", None)
    return {
        "id": instance.pk,
        "module": module,
        "name": _record_name(instance),
        "deleted_at": instance.deleted_at.isoformat() if instance.deleted_at else None,
        "owner_id": getattr(owner, "pk", None),
        "owner_email": getattr(owner, "email", None) if owner else None,
    }


def get_trash_items(
    *,
    tenant: "Organization",
    module: str | None = None,
) -> list[dict[str, Any]]:
    """Return soft-deleted CRM records across all modules (or just ``module``).

    Uses each model's ``all_objects`` manager (unscoped) filtered by
    ``tenant=tenant`` and ``deleted_at__isnull=False``, ordered by
    ``-deleted_at``.
    """
    modules = (module,) if module else ALL_MODULES
    out: list[dict[str, Any]] = []
    for mod in modules:
        try:
            model = resolve_module_model(mod)
        except ValueError:
            continue
        qs = (
            model.all_objects.filter(tenant=tenant, deleted_at__isnull=False)
            .order_by("-deleted_at")
            .select_related("owner")
        )
        for record in qs.iterator(chunk_size=200):
            out.append(_trash_record_to_dict(record, mod))
    out.sort(key=lambda item: item["deleted_at"] or "", reverse=True)
    return out


def restore_from_trash(*, tenant: "Organization", module: str, record_id: str) -> Any:
    """Restore a soft-deleted CRM record (set ``deleted_at=None``).

    Raises ``DoesNotExist`` if the record is not found in the tenant's trash.
    Returns the restored record.
    """
    model = resolve_module_model(module)
    record = model.all_objects.get(tenant=tenant, pk=record_id, deleted_at__isnull=False)
    record.restore()
    log_activity(
        tenant=tenant,
        user=_actor_for(record),
        module=module,
        record_id=str(record.pk),
        record_name=_record_name(record),
        action="restored",
        description=f"Restored {module} {record.pk} from trash.",
    )
    return record


def purge_from_trash(*, tenant: "Organization", module: str, record_id: str) -> None:
    """Permanently delete a soft-deleted CRM record.

    Raises ``DoesNotExist`` if the record is not found in the tenant's trash.
    """
    model = resolve_module_model(module)
    record = model.all_objects.get(tenant=tenant, pk=record_id, deleted_at__isnull=False)
    name = _record_name(record)
    log_activity(
        tenant=tenant,
        user=_actor_for(record),
        module=module,
        record_id=str(record.pk),
        record_name=name,
        action="deleted",
        description=f"Permanently purged {module} {record.pk} from trash.",
    )
    record.delete()

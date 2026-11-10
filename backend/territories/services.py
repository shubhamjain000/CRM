"""Service layer for the territories app.

Two public functions:

* :func:`realign_territory` — for each member of ``territory``, find
  the records matching the territory's ``rules`` and re-assign the
  ``owner`` to the member (round-robin across members). Returns a
  summary dict.

* :func:`evaluate_rules` — given a model queryset + a ``rules`` dict,
  return the filtered queryset. Used internally by ``realign``.

Rule schema (see :class:`territories.models.Territory`)::

    {
        "module": "lead" | "account" | "deal",
        "filters": {"field": "value", ...},
        "strategy": "round_robin" | "load_balance" | "all_to_manager"
    }

The runtime is intentionally conservative — unknown modules or
strategies return an empty queryset / no-op so a malformed rule never
crashes the caller.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover — typing only
    from .models import Territory


###############################################################################
# evaluate_rules
###############################################################################


_MODULE_MODEL_MAP = {
    "lead": ("leads.models", "Lead"),
    "account": ("accounts.models", "Account"),
    "deal": ("deals.models", "Deal"),
}


def _get_queryset(module: str) -> Any | None:
    """Return the unscoped queryset for the module, or None if unknown."""
    spec = _MODULE_MODEL_MAP.get(module)
    if spec is None:
        return None
    import importlib  # noqa: PLC0415

    mod = importlib.import_module(spec[0])
    return getattr(mod, spec[1]).objects.all()


def evaluate_rules(rules: dict[str, Any], tenant: Any) -> Any:  # type: ignore[no-untyped-def]
    """Apply ``rules`` to the appropriate model and return the queryset.

    Returns an empty list when the module is unknown or the filters
    don't apply.
    """
    module = rules.get("module")
    filters = rules.get("filters") or {}
    qs = _get_queryset(module)
    if qs is None:
        return []
    qs = qs.filter(tenant=tenant)
    try:
        qs = qs.filter(**filters)
    except Exception:  # pragma: no cover — defensive
        return []
    return qs


###############################################################################
# realign_territory
###############################################################################


def realign_territory(territory: "Territory") -> dict[str, Any]:  # type: ignore[no-untyped-def]
    """Re-assign every record matching ``territory.rules`` to a member.

    Strategies:
    * ``round_robin`` — distribute matching records across members in
      turn.
    * ``load_balance`` — assign all matching records to the member with
      the fewest existing assignments.
    * ``all_to_manager`` — assign every matching record to
      ``territory.manager`` (no-op if manager is None).

    Returns ``{matched, reassigned, strategy, members}``.
    """
    rules = territory.rules or {}
    strategy = rules.get("strategy", "round_robin")
    qs = evaluate_rules(rules, territory.tenant)
    matched = list(qs) if qs else []

    members = list(territory.members.select_related("user").order_by("id"))
    if not members:
        return {"matched": len(matched), "reassigned": 0, "strategy": strategy, "members": 0}

    reassigned = 0

    if strategy == "all_to_manager":
        if territory.manager_id is None:
            return {
                "matched": len(matched), "reassigned": 0,
                "strategy": strategy, "members": len(members),
            }
        for record in matched:
            if record.owner_id != territory.manager_id:
                record.owner_id = territory.manager_id
                record.save(update_fields=["owner_id", "updated_at"])
                reassigned += 1
        return {
            "matched": len(matched), "reassigned": reassigned,
            "strategy": strategy, "members": len(members),
        }

    if strategy == "load_balance":
        # Order members by current owned-record count ascending.
        def _count(member: Any) -> int:  # type: ignore[no-untyped-def]
            if not members:
                return 0
            owner_field = getattr(member.user, "owned_records_count", None)
            return owner_field or 0

        members_sorted = sorted(members, key=_count)
        target_user = members_sorted[0].user if members_sorted else None
        if target_user is not None:
            for record in matched:
                if record.owner_id != target_user.pk:
                    record.owner_id = target_user.pk
                    record.save(update_fields=["owner_id"])
                    reassigned += 1
        return {
            "matched": len(matched), "reassigned": reassigned,
            "strategy": strategy, "members": len(members),
        }

    # Default: round_robin.
    if not members:
        return {
            "matched": len(matched), "reassigned": 0,
            "strategy": strategy, "members": 0,
        }
    for idx, record in enumerate(matched):
        member = members[idx % len(members)]
        if record.owner_id != member.user_id:
            record.owner_id = member.user_id
            record.save(update_fields=["owner_id"])
            reassigned += 1
    return {
        "matched": len(matched), "reassigned": reassigned,
        "strategy": strategy, "members": len(members),
    }


__all__ = ["evaluate_rules", "realign_territory"]

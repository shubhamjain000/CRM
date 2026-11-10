"""DRF viewsets for the accounts app."""

from __future__ import annotations

from typing import Any, Iterable

from django.db.models import Model
from django.shortcuts import get_object_or_404
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from accounts.filters import AccountFilter
from accounts.models import Account
from accounts.serializers import AccountMergeSerializer, AccountSerializer
from api.crm_base import CRMModelViewSet
from api.permissions import HasPermission, IsTenantMember


class AccountViewSet(CRMModelViewSet):
    """CRUD + bulk actions for :class:`accounts.models.Account`."""

    serializer_class = AccountSerializer
    queryset = Account.objects.all()
    filterset_class = AccountFilter
    sort_fields: tuple[str, ...] = (
        "id",
        "name",
        "created_at",
        "updated_at",
        "last_activity",
        "annual_revenue",
        "employees",
        "account_type",
        "owner",
    )
    bulk_update_fields: tuple[str, ...] = (
        "owner",
        "account_type",
        "industry",
        "rating",
        "parent_account",
    )
    custom_field_module = "account"
    required_permission: Iterable[str] | str = "crm.accounts.read"

    # ------------------------------------------------------------------ perms per action

    def get_required_permission(self, request: Request) -> str | None:
        method = request.method or ""
        if method in ("GET", "HEAD", "OPTIONS"):
            return "crm.accounts.read"
        if method == "POST":
            return "crm.accounts.create"
        if method in ("PUT", "PATCH"):
            return "crm.accounts.update"
        if method == "DELETE":
            return "crm.accounts.delete"
        return None

    def get_permissions(self) -> Any:
        perm = self.get_required_permission(self.request)
        if perm is not None:
            return [IsAuthenticated(), IsTenantMember(), HasPermission(perm)]
        return super().get_permissions()

    # ------------------------------------------------------------------ perform_create

    def perform_create(self, serializer: AccountSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    def perform_update(self, serializer: AccountSerializer) -> None:  # type: ignore[override]
        serializer.save()

    # ------------------------------------------------------------------ merge override

    def _merge(self, source: Model, target: Model) -> None:
        """Copy non-empty fields from ``source`` to ``target``.

        Re-parents child accounts and contacts/deals that referenced ``source``
        so they point at ``target`` after the merge.
        """
        if not isinstance(source, Account) or not isinstance(target, Account):
            return
        copyable = [
            "industry",
            "annual_revenue",
            "employees",
            "website",
            "billing_address",
            "shipping_address",
            "ticker_symbol",
            "ownership",
            "sic_code",
            "description",
        ]
        for field in copyable:
            current = getattr(target, field)
            if not current:
                setattr(target, field, getattr(source, field))
        # Merge tags (union).
        source_tags = source.tags or []
        target_tags = target.tags or []
        target.tags = list(dict.fromkeys([*target_tags, *source_tags]))

        # Re-parent direct children of source → target.
        source.children.update(parent_account=target)

        # Re-parent contacts/deals.
        source.contacts.all().update(account=target)  # type: ignore[attr-defined]
        source.deals.all().update(account=target)  # type: ignore[attr-defined]

        target.save()

    @action(detail=False, methods=["post"], url_path="merge")
    def merge(self, request: Request) -> Response:  # type: ignore[override]
        """Validate the merge payload then delegate to the base implementation.

        The base class's :meth:`api.crm_base.CRMModelViewSet.merge` reads
        ``source_id`` / ``target_id`` from ``request.data``; we just validate
        them with :class:`AccountMergeSerializer` first. ``request.data`` may
        be a plain dict (JSON) or an immutable ``QueryDict`` (form-encoded) —
        rather than mutating it, we set ``request._full_data`` to a mutable
        copy with the validated IDs.
        """
        serializer = AccountMergeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        merged = {
            **request.data,
            "source_id": serializer.validated_data["source_id"],
            "target_id": serializer.validated_data["target_id"],
        }
        request._full_data = merged
        return super().merge(request)

    @action(detail=True, methods=["get"], url_path="hierarchy")
    def hierarchy(self, request: Request, pk: str | None = None) -> Response:
        """Return the account's subtree (self + descendants) two levels deep."""
        root = get_object_or_404(self.get_queryset(), pk=pk)
        children = list(root.children.all()[:50])
        out: dict[str, Any] = {
            "account": AccountSerializer(root, context={"request": request}).data,
            "children": AccountSerializer(children, many=True, context={"request": request}).data,
        }
        return Response(out)

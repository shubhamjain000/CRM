"""DRF viewsets for the contacts app."""

from __future__ import annotations

from typing import Any, Iterable

from django.db.models import Model
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from api.crm_base import CRMModelViewSet
from api.permissions import HasPermission, IsTenantMember
from contacts.filters import ContactFilter
from contacts.models import Contact
from contacts.serializers import ContactSerializer


class ContactViewSet(CRMModelViewSet):
    """CRUD + bulk actions for :class:`contacts.models.Contact`."""

    serializer_class = ContactSerializer
    queryset = Contact.objects.all()
    filterset_class = ContactFilter
    sort_fields: tuple[str, ...] = (
        "id",
        "first_name",
        "last_name",
        "created_at",
        "updated_at",
        "last_activity",
        "owner",
        "account",
    )
    bulk_update_fields: tuple[str, ...] = (
        "owner",
        "account",
        "lead_source",
        "do_not_call",
        "email_opt_out",
        "title",
        "department",
    )
    custom_field_module = "contact"
    required_permission: Iterable[str] | str = "crm.contacts.read"

    # ------------------------------------------------------------------ per-action perms

    def get_required_permission(self, request: Request) -> str | None:
        method = request.method or ""
        if method in ("GET", "HEAD", "OPTIONS"):
            return "crm.contacts.read"
        if method == "POST":
            return "crm.contacts.create"
        if method in ("PUT", "PATCH"):
            return "crm.contacts.update"
        if method == "DELETE":
            return "crm.contacts.delete"
        return None

    def get_permissions(self) -> Any:
        perm = self.get_required_permission(self.request)
        if perm is not None:
            return [IsAuthenticated(), IsTenantMember(), HasPermission(perm)]
        return super().get_permissions()

    # ------------------------------------------------------------------ perform_create

    def perform_create(self, serializer: ContactSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ merge override

    def _merge(self, source: Model, target: Model) -> None:  # type: ignore[override]
        """Copy non-empty fields from source → target, re-parent deals."""
        if not isinstance(source, Contact) or not isinstance(target, Contact):
            return
        copyable = [
            "title",
            "department",
            "assistant",
            "lead_source",
            "description",
            "birthday",
            "do_not_call",
            "email_opt_out",
            "social_profiles",
        ]
        for field in copyable:
            current = getattr(target, field)
            if not current:
                setattr(target, field, getattr(source, field))
        # Union emails/phones/addresses (dedupe by primary key).
        for list_field in ("emails", "phones", "addresses"):
            src_list = getattr(source, list_field) or []
            tgt_list = getattr(target, list_field) or []
            seen = set()
            merged = []
            for item in [*tgt_list, *src_list]:
                key = item.get("email") if isinstance(item, dict) and "email" in item else None
                key = key or (item.get("phone") if isinstance(item, dict) and "phone" in item else None)
                key = key or str(item)
                if key in seen:
                    continue
                seen.add(key)
                merged.append(item)
            setattr(target, list_field, merged)

        # Re-parent deals where source was primary_contact or a contacts M2M.
        source.deal_primary.all().update(primary_contact=target)  # type: ignore[attr-defined]
        for deal in source.deal_contacts.all():  # type: ignore[attr-defined]
            deal.contacts.remove(source)
            deal.contacts.add(target)

        target.save()

    @action(detail=True, methods=["get"], url_path="account")
    def account(self, request: Request, pk: str | None = None) -> Response:
        """Return the linked account (if any)."""
        from accounts.serializers import AccountSerializer

        contact = self.get_object()
        if contact.account_id is None:
            return Response({"detail": "No linked account."}, status=404)
        return Response(AccountSerializer(contact.account, context={"request": request}).data)

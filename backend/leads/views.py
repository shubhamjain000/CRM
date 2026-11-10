"""DRF viewsets for the leads app."""

from __future__ import annotations

from typing import Any, Iterable

from decimal import Decimal

from django.db import transaction
from django.db.models import Model
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from accounts.models import Account
from accounts.serializers import AccountSerializer
from api.crm_base import CRMModelViewSet
from api.permissions import HasPermission, IsTenantMember
from contacts.models import Contact
from contacts.serializers import ContactSerializer
from deals.models import Deal
from deals.models_pipeline import Pipeline, Stage
from deals.serializers import DealSerializer
from leads.filters import LeadFilter
from leads.models import Lead
from leads.serializers import LeadConvertSerializer, LeadSerializer


class LeadViewSet(CRMModelViewSet):
    """CRUD + bulk actions + ``convert_lead`` for :class:`leads.models.Lead`."""

    serializer_class = LeadSerializer
    queryset = Lead.objects.all()
    filterset_class = LeadFilter
    sort_fields: tuple[str, ...] = (
        "id",
        "first_name",
        "last_name",
        "company",
        "lead_status",
        "rating",
        "score",
        "annual_revenue",
        "employees",
        "created_at",
        "updated_at",
        "last_activity",
        "owner",
    )
    bulk_update_fields: tuple[str, ...] = (
        "owner",
        "assigned_to",
        "lead_status",
        "rating",
        "lead_source",
        "industry",
    )
    custom_field_module = "lead"
    required_permission: Iterable[str] | str = "crm.leads.read"

    # ------------------------------------------------------------------ per-action perms

    def get_required_permission(self, request: Request) -> str | None:
        method = request.method or ""
        if method in ("GET", "HEAD", "OPTIONS"):
            return "crm.leads.read"
        if method == "POST":
            return "crm.leads.create"
        if method in ("PUT", "PATCH"):
            return "crm.leads.update"
        if method == "DELETE":
            return "crm.leads.delete"
        return None

    def get_permissions(self) -> Any:
        perm = self.get_required_permission(self.request)
        if perm is not None:
            return [IsAuthenticated(), IsTenantMember(), HasPermission(perm)]
        return super().get_permissions()

    # ------------------------------------------------------------------ perform_create

    def perform_create(self, serializer: LeadSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ convert

    @action(detail=True, methods=["post"], url_path="convert")
    def convert_lead(self, request: Request, pk: str | None = None) -> Response:
        """Convert a lead into an account + contact + (optional) deal.

        Marks the lead ``is_converted=True``, ``lead_status=converted``, and
        stores the three FKs. Idempotent: re-converting returns the existing
        linked records.
        """
        lead = self.get_object()
        if lead.is_converted:
            return Response(
                {
                    "detail": "Lead is already converted.",
                    "account": (
                        AccountSerializer(lead.converted_account, context={"request": request}).data
                        if lead.converted_account_id
                        else None
                    ),
                    "contact": (
                        ContactSerializer(lead.converted_contact, context={"request": request}).data
                        if lead.converted_contact_id
                        else None
                    ),
                    "deal": (
                        DealSerializer(lead.converted_deal, context={"request": request}).data
                        if lead.converted_deal_id
                        else None
                    ),
                },
                status=status.HTTP_200_OK,
            )

        serializer = LeadConvertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            # 1. Account (or attach to existing by name within the tenant).
            account: Account | None = None
            if lead.company:
                account = Account.objects.filter(name=lead.company).first()
            if account is None:
                account = Account.objects.create(
                    tenant_id=lead.tenant_id,
                    name=lead.company or lead.full_name,
                    industry=lead.industry,
                    annual_revenue=lead.annual_revenue,
                    employees=lead.employees,
                    website=lead.website,
                    billing_address=lead.billing_address or {},
                    shipping_address=lead.shipping_address or {},
                    owner=lead.owner,
                    account_type="customer",
                )

            # 2. Contact.
            contact = Contact.objects.create(
                tenant_id=lead.tenant_id,
                first_name=lead.first_name,
                last_name=lead.last_name,
                account=account,
                title=lead.title,
                emails=lead.emails or [],
                phones=lead.phones or [],
                lead_source=lead.lead_source,
                owner=lead.owner,
                description=lead.description,
            )

            # 3. Deal (optional).
            deal: Deal | None = None
            if data.get("create_deal", True):
                pipeline = self._resolve_pipeline(lead, data)
                stage = self._resolve_stage(lead, data, pipeline)
                deal = Deal.objects.create(
                    tenant_id=lead.tenant_id,
                    name=data.get("deal_name") or f"{lead.full_name} — {lead.company or 'Opportunity'}",
                    amount=data.get("deal_amount") or lead.annual_revenue or Decimal("0"),
                    currency="USD",
                    stage=stage,
                    pipeline=pipeline,
                    close_date=data.get("close_date"),
                    probability=stage.probability if stage else 0.0,
                    account=account,
                    primary_contact=contact,
                    owner=lead.owner,
                    lead_source=lead.lead_source,
                    type="new_business",
                    description=lead.description,
                )

            # 4. Mark lead converted.
            lead.is_converted = True
            lead.lead_status = Lead.STATUS_CONVERTED
            lead.converted_account = account
            lead.converted_contact = contact
            lead.converted_deal = deal
            lead.save(update_fields=[
                "is_converted",
                "lead_status",
                "converted_account",
                "converted_contact",
                "converted_deal",
                "updated_at",
            ])

        return Response(
            {
                "lead": LeadSerializer(lead, context={"request": request}).data,
                "account": AccountSerializer(account, context={"request": request}).data,
                "contact": ContactSerializer(contact, context={"request": request}).data,
                "deal": DealSerializer(deal, context={"request": request}).data if deal else None,
            },
            status=status.HTTP_201_CREATED,
        )

    def _resolve_pipeline(self, lead: Lead, data: dict) -> Pipeline:
        if data.get("pipeline_id"):
            return get_object_or_404(Pipeline, pk=data["pipeline_id"])
        default_pipeline = Pipeline.objects.filter(is_default=True).first()
        if default_pipeline is not None:
            return default_pipeline
        first = Pipeline.objects.first()
        if first is not None:
            return first
        # Last resort: create one.
        return Pipeline.objects.create(tenant_id=lead.tenant_id, name="Sales Pipeline", is_default=True)

    def _resolve_stage(self, lead: Lead, data: dict, pipeline: Pipeline) -> Stage:
        if data.get("stage_id"):
            return get_object_or_404(Stage, pk=data["stage_id"], pipeline_id=pipeline.pk)
        first_stage = (
            Stage.objects.filter(pipeline_id=pipeline.pk).order_by("order", "id").first()
        )
        if first_stage is not None:
            return first_stage
        return Stage.objects.create(
            tenant_id=lead.tenant_id,
            pipeline=pipeline,
            name="Prospect",
            probability=10.0,
            order=0,
        )

    # ------------------------------------------------------------------ merge override

    def _merge(self, source: Model, target: Model) -> None:  # type: ignore[override]
        """Copy non-empty fields from source → target."""
        if not isinstance(source, Lead) or not isinstance(target, Lead):
            return
        copyable = [
            "company",
            "title",
            "industry",
            "annual_revenue",
            "employees",
            "website",
            "billing_address",
            "shipping_address",
            "description",
            "lead_source",
            "rating",
        ]
        for field in copyable:
            current = getattr(target, field)
            if not current:
                setattr(target, field, getattr(source, field))
        # Higher score wins.
        if source.score > target.score:
            target.score = source.score
        # Union emails/phones.
        for list_field in ("emails", "phones"):
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
        target.save()

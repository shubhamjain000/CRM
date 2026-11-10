"""Model-layer tests for the marketing app."""

from __future__ import annotations

from datetime import date

import pytest

from marketing.models import (
    C_DRAFT,
    C_EMAIL,
    C_RUNNING,
    Campaign,
    MarketingEmail,
    SubscriberList,
)


pytestmark = pytest.mark.django_db


def test_campaign_subscriberlist_and_email_round_trip(active_tenant):  # type: ignore[no-untyped-def]
    campaign = Campaign.objects.create(
        tenant=active_tenant,
        name="Black Friday",
        type=C_EMAIL,
        status=C_DRAFT,
        start_date=date(2024, 11, 24),
        end_date=date(2024, 11, 30),
        metrics={"target": 1000},
    )
    slist = SubscriberList.objects.create(
        tenant=active_tenant,
        name="Newsletter",
        subscriber_count=3,
        subscribers=["a@x.com", "b@x.com", "c@x.com"],
    )
    email = MarketingEmail.objects.create(
        tenant=active_tenant,
        campaign=campaign,
        subject="50% off everything",
        body_html="<p>Shop now</p>",
        sent_count=100,
        open_count=40,
        click_count=10,
    )
    assert campaign.status == C_DRAFT
    assert campaign.type == C_EMAIL
    assert slist.subscriber_count == 3
    assert email.campaign_id == campaign.pk
    campaign.status = C_RUNNING
    campaign.save(update_fields=["status", "updated_at"])
    assert campaign.status == C_RUNNING
    assert str(campaign) == "Campaign: Black Friday (email)"
    assert str(slist) == "List: Newsletter (3)"

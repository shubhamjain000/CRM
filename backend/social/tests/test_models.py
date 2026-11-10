"""Model-layer tests for the social app."""

from __future__ import annotations

import pytest

from social.factories import (
    ScheduledPostFactory,
    SocialAccountFactory,
    SocialMentionFactory,
)
from social.models import ScheduledPost, SocialMention


pytestmark = pytest.mark.django_db


def test_social_account_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    account = SocialAccountFactory(tenant=active_tenant, provider="twitter", handle="@acme")
    assert account.is_active is True
    assert "twitter" in str(account)
    assert "@acme" in str(account)


def test_mention_unique_per_provider_message_id(active_tenant, user):  # type: ignore[no-untyped-def]
    account = SocialAccountFactory(tenant=active_tenant)
    SocialMentionFactory(tenant=active_tenant, account=account, provider="twitter", message_id="m1")
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        SocialMentionFactory(
            tenant=active_tenant, account=account, provider="twitter", message_id="m1"
        )
    assert SocialMention.objects.filter(tenant=active_tenant).count() == 1


def test_scheduled_post_factory_defaults(active_tenant, user):  # type: ignore[no-untyped-def]
    post = ScheduledPostFactory(tenant=active_tenant)
    assert post.status == "scheduled"
    assert post.posted_at is None
    assert ScheduledPost.objects.filter(tenant=active_tenant).count() == 1


def test_mention_str_contains_provider_and_body(active_tenant, user):  # type: ignore[no-untyped-def]
    mention = SocialMentionFactory(
        tenant=active_tenant, body="Hello world", author_handle="@x"
    )
    s = str(mention)
    assert "twitter" in s.lower() or "x" in s.lower()
    assert "Hello world" in s

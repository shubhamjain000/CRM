"""Service-layer tests for the social app."""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone

from social.factories import (
    ScheduledPostFactory,
    SocialAccountFactory,
    SocialMentionFactory,
)
from social.services import (
    analyze_sentiment,
    publish_due_posts,
    respond_to_mention,
    schedule_post,
    sync_mentions,
)


def _fake_mentions(account):
    return [
        {
            "message_id": f"mid-{account.pk}-1",
            "author": "Jane Doe",
            "author_handle": "@jane",
            "body": "I love this product!",
            "media": [],
            "url": "https://twitter.com/jane/status/1",
            "created_at": timezone.now(),
        },
        {
            "message_id": f"mid-{account.pk}-2",
            "author": "Bob",
            "author_handle": "@bob",
            "body": "This is broken and terrible.",
            "media": [],
            "url": "https://twitter.com/bob/status/2",
            "created_at": timezone.now(),
        },
    ]


def test_sync_mentions_dedupes_and_classifies_sentiment(active_tenant, db):  # type: ignore[no-untyped-def]
    account = SocialAccountFactory(tenant=active_tenant, provider="twitter")
    with patch("social.services._provider_fetch_mentions", side_effect=_fake_mentions):
        first = sync_mentions(account)
        second = sync_mentions(account)
    assert len(first) == 2
    assert second == []
    sentiments = sorted(m.sentiment for m in first)
    assert sentiments == ["negative", "positive"]


def test_respond_to_mention_stamps_responded_at(active_tenant, db):  # type: ignore[no-untyped-def]
    mention = SocialMentionFactory(tenant=active_tenant, is_read=False)
    with patch("social.services._provider_reply_to_mention"):
        respond_to_mention(mention, "Thanks!")
    mention.refresh_from_db()
    assert mention.responded_at is not None
    assert mention.is_read is True


def test_schedule_post_creates_scheduled_row(active_tenant, db):  # type: ignore[no-untyped-def]
    account = SocialAccountFactory(tenant=active_tenant)
    post = schedule_post(
        account=account,
        content="Big announcement!",
        scheduled_at=timezone.now() + timedelta(hours=1),
    )
    assert post.status == "scheduled"
    assert post.posted_at is None


def test_publish_due_posts_publishes_only_overdue(active_tenant, db):  # type: ignore[no-untyped-def]
    account = SocialAccountFactory(tenant=active_tenant)
    due = ScheduledPostFactory(
        tenant=active_tenant, account=account, scheduled_at=timezone.now() - timedelta(minutes=5)
    )
    not_due = ScheduledPostFactory(
        tenant=active_tenant, account=account, scheduled_at=timezone.now() + timedelta(hours=1)
    )
    with patch("social.services._provider_publish_post"):
        result = publish_due_posts()
    assert result["posted"] >= 1
    due.refresh_from_db()
    not_due.refresh_from_db()
    assert due.status == "posted"
    assert due.posted_at is not None
    assert not_due.status == "scheduled"


def test_analyze_sentiment_keyword_classifier():  # type: ignore[no-untyped-def]
    assert analyze_sentiment("I love this, it's amazing") == "positive"
    assert analyze_sentiment("This is broken and awful") == "negative"
    assert analyze_sentiment("Just an FYI") == "neutral"
    assert analyze_sentiment("") == "neutral"

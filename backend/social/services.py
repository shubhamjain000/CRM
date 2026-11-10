"""Service layer for the social app.

Provider glue (Twitter API v2 / LinkedIn Marketing API / Facebook Graph
API / Instagram Graph API) is stubbed behind the ``_provider_fetch_mentions``
/ ``_provider_publish_post`` / ``_provider_reply_to_mention`` hooks. The
service layer is provider-agnostic.

:func:`analyze_sentiment` is a stub that returns a deterministic label
based on a tiny keyword list — production swaps in an LLM call.
"""

from __future__ import annotations

import logging
from typing import Any

from django.utils import timezone

from .models import (
    POST_FAILED,
    POST_POSTED,
    POST_SCHEDULED,
    SENTIMENT_NEGATIVE,
    SENTIMENT_NEUTRAL,
    SENTIMENT_POSITIVE,
    ScheduledPost,
    SocialAccount,
    SocialMention,
)

log = logging.getLogger(__name__)

# Keyword lexicon for the stub sentiment classifier.
_POSITIVE_WORDS = {"great", "love", "awesome", "thanks", "amazing", "happy", "good", "excellent"}
_NEGATIVE_WORDS = {"bad", "hate", "awful", "terrible", "angry", "broken", "worst", "frustrated"}


###############################################################################
# Mention sync (Celery task)
###############################################################################


def sync_mentions(account: SocialAccount) -> list[SocialMention]:
    """Pull new mentions for ``account`` from the provider API.

    De-duplicates by ``(tenant, provider, message_id)`` and classifies
    sentiment via :func:`analyze_sentiment`. Returns the list of newly
    created :class:`SocialMention` rows.
    """
    if not account.is_active:
        return []
    raw_mentions = _provider_fetch_mentions(account)
    if not raw_mentions:
        return []
    existing_ids = set(
        SocialMention.objects.filter(
            tenant=account.tenant,
            provider=account.provider,
            message_id__in=[m.get("message_id") for m in raw_mentions if m.get("message_id")],
        ).values_list("message_id", flat=True)
    )
    created: list[SocialMention] = []
    for raw in raw_mentions:
        mid = str(raw.get("message_id", ""))
        if not mid or mid in existing_ids:
            continue
        body = str(raw.get("body", ""))
        mention = SocialMention.objects.create(
            tenant=account.tenant,
            account=account,
            provider=account.provider,
            message_id=mid,
            author=str(raw.get("author", "")),
            author_handle=str(raw.get("author_handle", "")),
            body=body,
            media=raw.get("media") or [],
            url=str(raw.get("url", "")),
            sentiment=analyze_sentiment(body),
            created_at=raw.get("created_at") or timezone.now(),
        )
        created.append(mention)
    log.info("social.sync_mentions: %d new mention(s) for %s", len(created), account)
    return created


###############################################################################
# Outbound reply
###############################################################################


def respond_to_mention(mention: SocialMention, body: str) -> SocialMention:
    """Reply to ``mention`` with ``body`` and stamp ``responded_at``.

    Dispatches via the stubbed :func:`_provider_reply_to_mention` hook
    (which would post a threaded reply on the provider). Even if the
    provider call fails, we still mark the mention as responded to —
    the agent's intent is captured.
    """
    if mention.account is None:
        raise ValueError("respond_to_mention: mention has no associated account.")
    try:
        _provider_reply_to_mention(mention.account, mention, body)
    except Exception:  # pragma: no cover — defensive
        log.exception("social.respond_to_mention: provider call failed for mention %s", mention.pk)
    mention.responded_at = timezone.now()
    mention.is_read = True
    mention.save(update_fields=["responded_at", "is_read", "updated_at"])
    return mention


###############################################################################
# Scheduled posts
###############################################################################


def schedule_post(
    account: SocialAccount,
    content: str,
    scheduled_at: Any,
    media: list[dict[str, Any]] | None = None,
) -> ScheduledPost:
    """Queue a post on ``account`` for dispatch at ``scheduled_at``."""
    return ScheduledPost.objects.create(
        tenant=account.tenant,
        account=account,
        content=content,
        media=list(media or []),
        scheduled_at=scheduled_at,
        status=POST_SCHEDULED,
    )


def publish_due_posts() -> dict[str, Any]:
    """Publish every scheduled post whose ``scheduled_at`` has elapsed.

    Called by the ``social-publish-scheduled`` Celery beat task every
    minute. Per-post failures are isolated.
    """
    now = timezone.now()
    due = ScheduledPost.objects.filter(status=POST_SCHEDULED, scheduled_at__lte=now).select_related(
        "account", "tenant"
    )
    posted = 0
    failed = 0
    for post in due:
        try:
            _provider_publish_post(post.account, post)
            post.status = POST_POSTED
            post.posted_at = timezone.now()
            post.save(update_fields=["status", "posted_at", "updated_at"])
            posted += 1
        except Exception as exc:  # pragma: no cover — defensive
            post.status = POST_FAILED
            post.error_message = str(exc)[:2000]
            post.save(update_fields=["status", "error_message", "updated_at"])
            log.exception("social.publish_due_posts: post %s failed", post.pk)
            failed += 1
    return {"posted": posted, "failed": failed}


###############################################################################
# Sentiment analysis (stub)
###############################################################################


def analyze_sentiment(text: str) -> str:
    """Return a coarse sentiment label for ``text``.

    Stub implementation: counts positive / negative keyword hits and
    returns the dominant label (ties → ``neutral``). Production swaps
    in an LLM / dedicated sentiment API call.
    """
    if not text:
        return SENTIMENT_NEUTRAL
    tokens = {t.strip(".,!?;:\"'()").lower() for t in text.split()}
    pos = len(tokens & _POSITIVE_WORDS)
    neg = len(tokens & _NEGATIVE_WORDS)
    if pos > neg:
        return SENTIMENT_POSITIVE
    if neg > pos:
        return SENTIMENT_NEGATIVE
    return SENTIMENT_NEUTRAL


###############################################################################
# Provider stubs
###############################################################################


def _provider_fetch_mentions(account: SocialAccount) -> list[dict[str, Any]]:
    """Stub provider fetcher — override in production.

    Returns a list of dicts shaped like::

        {"message_id": "...", "author": "...", "author_handle": "...",
         "body": "...", "media": [], "url": "...", "created_at": datetime}
    """
    return []


def _provider_reply_to_mention(
    account: SocialAccount, mention: SocialMention, body: str
) -> None:
    """Stub reply sender — override in production."""
    return None


def _provider_publish_post(account: SocialAccount, post: ScheduledPost) -> None:
    """Stub publisher — override in production."""
    return None


__all__ = [
    "analyze_sentiment",
    "publish_due_posts",
    "respond_to_mention",
    "schedule_post",
    "sync_mentions",
]

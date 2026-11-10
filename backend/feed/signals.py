"""Signal handlers for the feed app.

Wired in :meth:`feed.apps.FeedConfig.ready`.

Responsibilities
----------------
* On every ``post_save`` of :class:`FeedPost` (create or update), parse
  @mentions and #hashtags out of ``body`` and persist them in
  ``mentions`` / ``hashtags``. The parse runs via ``update()`` so it doesn't
  recurse into the signal.
* On create of :class:`FeedPost`, log a ``feed.posted`` activity on the
  related CRM record (if any) via :func:`crm_ux.services.log_activity`.
* On create of :class:`FeedComment`, parse @mentions and notify:
    - each mentioned user (verb ``mentioned``)
    - the post's author, if the commenter isn't the author (verb ``commented``)
"""

from __future__ import annotations

from typing import Any

from django.db.models.base import ModelBase
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from .models import FeedComment, FeedPost
from .services import parse_mentions_and_hashtags


def _is_soft_delete_save(update_fields: set[str] | None) -> bool:
    """Return ``True`` when this save only touches ``deleted_at``."""
    if not update_fields:
        return False
    return update_fields <= {"deleted_at", "updated_at", "edited_at"}


@receiver(post_save, sender=FeedPost)
def feed_post_post_save(
    sender: ModelBase,
    instance: FeedPost,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Parse mentions/hashtags, log an activity, and stamp ``edited_at`` on edits."""
    if raw or instance.tenant_id is None:
        return

    update_fields = kwargs.get("update_fields")
    update_fields_set: set[str] | None = set(update_fields) if update_fields else None

    # Re-parse mentions + hashtags from the body on every non-soft-delete save.
    if not _is_soft_delete_save(update_fields_set):
        parsed = parse_mentions_and_hashtags(instance.body or "", tenant=instance.tenant)
        if instance.mentions != parsed["mentions"] or instance.hashtags != parsed["hashtags"]:
            FeedPost.objects.filter(pk=instance.pk).update(
                mentions=parsed["mentions"],
                hashtags=parsed["hashtags"],
            )
            instance.mentions = parsed["mentions"]
            instance.hashtags = parsed["hashtags"]

    # On create (or first non-soft-delete save with a related record), log an
    # activity to the CRM record's timeline.
    if created and instance.related_module and instance.related_id:
        try:
            from crm_ux.services import log_activity

            log_activity(
                tenant=instance.tenant,
                user=instance.author,
                module=instance.related_module,
                record_id=str(instance.related_id),
                record_name=(instance.body or "")[:80],
                action="note_added",
                description=f"Feed post by {instance.author.email}: {(instance.body or '')[:80]}",
                metadata={"feed_post_id": instance.pk},
            )
        except Exception:  # pragma: no cover — defensive: never break a post save
            pass


@receiver(post_save, sender=FeedComment)
def feed_comment_post_save(
    sender: ModelBase,
    instance: FeedComment,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Parse mentions and dispatch notifications on comment creation."""
    if raw or instance.tenant_id is None:
        return

    update_fields = kwargs.get("update_fields")
    update_fields_set: set[str] | None = set(update_fields) if update_fields else None

    if not _is_soft_delete_save(update_fields_set):
        parsed = parse_mentions_and_hashtags(instance.body or "", tenant=instance.tenant)
        if instance.mentions != parsed["mentions"]:
            FeedComment.objects.filter(pk=instance.pk).update(mentions=parsed["mentions"])
            instance.mentions = parsed["mentions"]

    if not created:
        return

    # Lazy import to avoid a circular dependency at app load.
    try:
        from notifications.services import create_notification
    except Exception:  # pragma: no cover — notifications app must always be present
        return

    post = instance.post
    author = instance.author

    # 1. Notify mentioned users (verb "mentioned").
    for user_id in instance.mentions or []:
        if user_id == author.pk:
            continue
        try:
            create_notification(
                tenant=instance.tenant,
                actor=author,
                verb="mentioned",
                target_module="feed",
                target_id=str(instance.pk),
                target_name=f"Comment on post #{post.pk}",
                recipient_id=user_id,
                data={
                    "post_id": post.pk,
                    "comment_id": instance.pk,
                    "author_id": author.pk,
                    "author_name": author.name or author.email,
                    "preview": (instance.body or "")[:160],
                },
            )
        except Exception:  # pragma: no cover
            pass

    # 2. Notify the post's author (verb "commented"), unless they're the commenter.
    if post.author_id and post.author_id != author.pk:
        try:
            create_notification(
                tenant=instance.tenant,
                actor=author,
                verb="commented",
                target_module="feed",
                target_id=str(post.pk),
                target_name=f"Post #{post.pk}",
                recipient_id=post.author_id,
                data={
                    "post_id": post.pk,
                    "comment_id": instance.pk,
                    "author_id": author.pk,
                    "author_name": author.name or author.email,
                    "preview": (instance.body or "")[:160],
                    "timestamp": timezone.now().isoformat(),
                },
            )
        except Exception:  # pragma: no cover
            pass

"""Celery tasks for the social app.

* :func:`sync_all_mentions` — beat every 5 min, sweeps every active
  :class:`SocialAccount` and pulls new mentions.
* :func:`publish_scheduled_posts` — beat every 1 min, dispatches due
  :class:`ScheduledPost` rows.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task

from .models import SocialAccount
from .services import publish_due_posts, sync_mentions

log = logging.getLogger(__name__)


@shared_task(name="social.sync_all_mentions")
def sync_all_mentions() -> dict[str, Any]:
    """Sweep every active :class:`SocialAccount` and pull new mentions."""
    accounts = SocialAccount.objects.filter(is_active=True)
    total_new = 0
    synced = 0
    failed = 0
    for account in accounts:
        try:
            created = sync_mentions(account)
            total_new += len(created)
            synced += 1
        except Exception:  # pragma: no cover — defensive
            log.exception("social.sync_all_mentions: account %s failed", account.pk)
            failed += 1
    return {"accounts_synced": synced, "new_mentions": total_new, "failed": failed}


@shared_task(name="social.publish_scheduled_posts")
def publish_scheduled_posts() -> dict[str, Any]:
    """Dispatch every scheduled post whose ``scheduled_at`` has elapsed."""
    return publish_due_posts()

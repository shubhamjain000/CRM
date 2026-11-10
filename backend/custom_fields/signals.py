"""Signal handlers for the custom_fields app.

On ``post_save`` of :class:`custom_fields.models.CustomField`:

* if the field has a non-empty ``default_value`` and is being created (not
  updated), enqueue :func:`custom_fields.tasks.backfill_defaults_for_field`
  so the default is propagated to all existing records of the field's module.

The task is dispatched async (Celery ``.delay()``) so the request isn't
blocked. If Celery isn't running, the task is still enqueued in the broker.
"""

from __future__ import annotations

from typing import Any

from django.db.models.base import ModelBase
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import CustomField


@receiver(post_save, sender=CustomField)
def custom_field_post_save(
    sender: ModelBase,
    instance: CustomField,
    created: bool,
    **kwargs: Any,
) -> None:
    """Enqueue the backfill task when a custom field with a default is created."""
    if not created:
        return
    if not instance.default_value:
        return
    # Import inside the handler to avoid an import cycle at app-load time.
    from .tasks import backfill_defaults_for_field

    backfill_defaults_for_field.delay(
        field_id=instance.pk,
        module=instance.module,
        tenant_id=instance.tenant_id,
    )

"""Django admin registration for the CRM UX app.

Read-only by default — UX data is primarily managed via the API. Admin
registration exists for support / debugging.
"""

from __future__ import annotations

from django.contrib import admin

from .models import (
    Activity,
    FileAttachment,
    Note,
    RecordLock,
    RecentlyViewed,
    SavedView,
)


@admin.register(SavedView)
class SavedViewAdmin(admin.ModelAdmin):
    list_display = ("id", "tenant", "user", "module", "name", "is_shared", "is_default")
    list_filter = ("module", "is_shared", "is_default")
    search_fields = ("name", "user__email")
    readonly_fields = ("created_at", "updated_at")


@admin.register(RecentlyViewed)
class RecentlyViewedAdmin(admin.ModelAdmin):
    list_display = ("id", "tenant", "user", "module", "record_id", "viewed_at")
    list_filter = ("module",)
    search_fields = ("user__email", "record_id")
    readonly_fields = ("created_at", "updated_at", "viewed_at")


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display = ("id", "tenant", "user", "module", "record_id", "action", "created_at")
    list_filter = ("module", "action")
    search_fields = ("record_id", "record_name", "description", "user__email")
    readonly_fields = ("created_at", "updated_at")


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ("id", "tenant", "user", "module", "record_id", "created_at")
    list_filter = ("module",)
    search_fields = ("body", "record_id", "user__email")
    readonly_fields = ("created_at", "updated_at")


@admin.register(FileAttachment)
class FileAttachmentAdmin(admin.ModelAdmin):
    list_display = ("id", "tenant", "user", "module", "record_id", "filename", "file_size", "created_at")
    list_filter = ("module", "mime_type")
    search_fields = ("filename", "record_id", "user__email")
    readonly_fields = ("created_at", "updated_at")


@admin.register(RecordLock)
class RecordLockAdmin(admin.ModelAdmin):
    list_display = ("id", "tenant", "user", "module", "record_id", "locked_at", "expires_at")
    list_filter = ("module",)
    search_fields = ("record_id", "user__email")
    readonly_fields = ("created_at", "updated_at", "locked_at", "expires_at")

"""File + sharing + audit models.

Design notes
------------
* :class:`File` inherits :class:`api.soft_delete.SoftDeleteTenantModel`
  (tenant FK + timestamps + soft-delete-aware managers). The actual file
  bytes live in S3 / MinIO at ``storage_key``; this row is the metadata.
* ``storage_provider`` declares where the bytes live (``s3`` / ``minio``
  / ``r2``) so multi-region / multi-bucket deployments can resolve the
  correct endpoint.
* ``shared_with`` is an M2M through :class:`FileShare` granting per-user
  permission (read / download / admin). Uploader always implicitly has
  admin.
* :class:`FileVersion` records each upload (``version_number`` per file).
  The active ``storage_key`` / ``size`` always reflects the current
  version; older versions keep their own ``storage_key`` for restore.
* :class:`ShareLink` is a tokenized public-ish download URL with optional
  password, expiry, and download-limit. ``watermark=True`` forces a
  per-recipient watermark overlay on PDF downloads.
* :class:`DownloadLog` is an append-only audit row — both authenticated
  downloads and anonymous share-link downloads land here. ``watermarked``
  records whether the watermark was actually applied.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import User
from api.soft_delete import SoftDeleteTenantModel


class File(SoftDeleteTenantModel):
    """An S3-backed file (image / PDF / doc / video / etc.)."""

    STORAGE_S3 = "s3"
    STORAGE_MINIO = "minio"
    STORAGE_R2 = "r2"
    STORAGE_PROVIDER_CHOICES = [
        (STORAGE_S3, "Amazon S3"),
        (STORAGE_MINIO, "MinIO"),
        (STORAGE_R2, "Cloudflare R2"),
    ]

    VIRUS_SCAN_PENDING = "pending"
    VIRUS_SCAN_CLEAN = "clean"
    VIRUS_SCAN_INFECTED = "infected"
    VIRUS_SCAN_SKIPPED = "skipped"
    VIRUS_SCAN_CHOICES = [
        (VIRUS_SCAN_PENDING, "Pending"),
        (VIRUS_SCAN_CLEAN, "Clean"),
        (VIRUS_SCAN_INFECTED, "Infected"),
        (VIRUS_SCAN_SKIPPED, "Skipped"),
    ]

    OCR_PENDING = "pending"
    OCR_DONE = "done"
    OCR_FAILED = "failed"
    OCR_SKIPPED = "skipped"
    OCR_CHOICES = [
        (OCR_PENDING, "Pending"),
        (OCR_DONE, "Done"),
        (OCR_FAILED, "Failed"),
        (OCR_SKIPPED, "Skipped"),
    ]

    name = models.CharField(max_length=255)
    original_name = models.CharField(max_length=512, blank=True, default="")
    size = models.BigIntegerField(default=0)
    mime_type = models.CharField(max_length=255, blank=True, default="", db_index=True)
    extension = models.CharField(max_length=32, blank=True, default="")
    storage_key = models.CharField(max_length=512)
    storage_provider = models.CharField(
        max_length=16,
        choices=STORAGE_PROVIDER_CHOICES,
        default=STORAGE_MINIO,
    )
    version = models.PositiveIntegerField(default=1)
    uploaded_by = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="uploaded_files",
        db_index=True,
    )
    related_module = models.CharField(
        max_length=32,
        blank=True,
        default="",
        db_index=True,
        help_text="CRM module this file relates to (lead/contact/account/deal/task/event/note).",
    )
    related_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    shared_with = models.ManyToManyField(
        User,
        through="FileShare",
        related_name="shared_files",
        blank=True,
    )
    preview_url = models.URLField(max_length=1024, blank=True, default="")
    thumbnail_url = models.URLField(max_length=1024, blank=True, default="")
    is_starred = models.BooleanField(default=False, db_index=True)
    description = models.TextField(blank=True, default="")
    tags = models.JSONField(default=list, blank=True)
    virus_scan_status = models.CharField(
        max_length=16,
        choices=VIRUS_SCAN_CHOICES,
        default=VIRUS_SCAN_PENDING,
        db_index=True,
    )
    ocr_text = models.TextField(blank=True, default="")
    ocr_status = models.CharField(
        max_length=16,
        choices=OCR_CHOICES,
        default=OCR_SKIPPED,
    )

    class Meta:
        db_table = "files_file"
        verbose_name = "file"
        verbose_name_plural = "files"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(
                    storage_provider__in=("s3", "minio", "r2")
                ),
                name="files_storage_provider_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    virus_scan_status__in=("pending", "clean", "infected", "skipped")
                ),
                name="files_virus_scan_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(ocr_status__in=("pending", "done", "failed", "skipped")),
                name="files_ocr_status_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "deleted_at"], name="files_tenant_deleted_idx"),
            models.Index(
                fields=["tenant", "uploaded_by", "-created_at"],
                name="files_uploader_created_idx",
            ),
            models.Index(
                fields=["tenant", "related_module", "related_id"],
                name="files_related_idx",
            ),
            models.Index(fields=["tenant", "is_starred"], name="files_starred_idx"),
            models.Index(
                fields=["tenant", "virus_scan_status"],
                name="files_virus_scan_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.mime_type or 'unknown'})"

    # ------------------------------------------------------------------ helpers

    @property
    def is_image(self) -> bool:
        return self.mime_type.startswith("image/")

    @property
    def is_pdf(self) -> bool:
        return self.mime_type == "application/pdf"

    @property
    def is_video(self) -> bool:
        return self.mime_type.startswith("video/")

    def next_version_number(self) -> int:
        """Return the next version number for this file (1-based, gap-free)."""
        last = (
            FileVersion.all_objects.filter(file_id=self.pk).order_by("-version_number").first()
        )
        return (last.version_number + 1) if last else 1


class FileShare(models.Model):
    """Through model for ``File.shared_with`` — per-user permission level."""

    PERMISSION_READ = "read"
    PERMISSION_DOWNLOAD = "download"
    PERMISSION_ADMIN = "admin"
    PERMISSION_CHOICES = [
        (PERMISSION_READ, "Read (preview only)"),
        (PERMISSION_DOWNLOAD, "Download"),
        (PERMISSION_ADMIN, "Admin"),
    ]

    file = models.ForeignKey(
        File,
        on_delete=models.CASCADE,
        related_name="shares",
        db_index=True,
    )
    user = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="file_shares",
        db_index=True,
    )
    permission = models.CharField(
        max_length=16,
        choices=PERMISSION_CHOICES,
        default=PERMISSION_READ,
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "files_share"
        verbose_name = "file share"
        verbose_name_plural = "file shares"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["file", "user"],
                name="fileshare_unique_per_file_user",
            ),
            models.CheckConstraint(
                condition=models.Q(permission__in=("read", "download", "admin")),
                name="fileshare_permission_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "permission"], name="fileshare_user_perm_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user.email} → {self.file} ({self.permission})"


class FileVersion(models.Model):
    """An immutable version snapshot for a :class:`File`."""

    file = models.ForeignKey(
        File,
        on_delete=models.CASCADE,
        related_name="versions",
        db_index=True,
    )
    version_number = models.PositiveIntegerField()
    size = models.BigIntegerField(default=0)
    storage_key = models.CharField(max_length=512)
    uploaded_by = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="file_versions_uploaded",
    )
    change_summary = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "files_version"
        verbose_name = "file version"
        verbose_name_plural = "file versions"
        ordering = ["-version_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["file", "version_number"],
                name="fileversion_unique_per_file_number",
            ),
        ]
        indexes = [
            models.Index(fields=["file", "version_number"], name="fileversion_num_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.file} v{self.version_number}"


class ShareLink(models.Model):
    """A tokenized, optionally expiring download link for a :class:`File`."""

    file = models.ForeignKey(
        File,
        on_delete=models.CASCADE,
        related_name="share_links",
        db_index=True,
    )
    token = models.CharField(max_length=128, unique=True, db_index=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="created_share_links",
    )
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    password_hash = models.CharField(max_length=255, blank=True, default="")
    download_limit = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Maximum number of downloads permitted; null = unlimited.",
    )
    download_count = models.PositiveIntegerField(default=0)
    watermark = models.BooleanField(
        default=True,
        help_text="Apply a per-recipient watermark overlay on PDF downloads.",
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "files_share_link"
        verbose_name = "share link"
        verbose_name_plural = "share links"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["file"], name="sharelink_file_idx"),
            models.Index(fields=["token"], name="sharelink_token_idx"),
        ]

    def __str__(self) -> str:
        return f"ShareLink {self.token[:8]}… → {self.file}"

    @property
    def is_expired(self) -> bool:
        return self.expires_at is not None and timezone.now() >= self.expires_at

    @property
    def is_exhausted(self) -> bool:
        return self.download_limit is not None and self.download_count >= self.download_limit


class DownloadLog(models.Model):
    """Append-only audit row for every file download."""

    file = models.ForeignKey(
        File,
        on_delete=models.CASCADE,
        related_name="download_logs",
        db_index=True,
    )
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="download_logs",
        help_text="Null for anonymous share-link downloads.",
    )
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True, default="")
    share_link = models.ForeignKey(
        ShareLink,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="download_logs",
    )
    watermarked = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "files_download_log"
        verbose_name = "download log"
        verbose_name_plural = "download logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["file", "-created_at"], name="dllog_file_created_idx"),
            models.Index(fields=["user", "-created_at"], name="dllog_user_created_idx"),
        ]

    def __str__(self) -> str:
        who = self.user.email if self.user_id else "anonymous"
        return f"{who} downloaded {self.file} @ {self.created_at:%Y-%m-%d %H:%M}"

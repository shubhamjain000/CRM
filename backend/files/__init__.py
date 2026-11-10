"""Files app — S3-backed file storage with versioning, virus scan, OCR, and DLP.

Provides:

* :class:`files.models.File` — a tenant-scoped, soft-deletable file record
  pointing at an S3/MinIO object via ``storage_key``.
* :class:`files.models.FileShare` — M2M-through model granting per-user
  permissions (read / download / admin).
* :class:`files.models.FileVersion` — version snapshots for restore-via-copy.
* :class:`files.models.ShareLink` — public-ish download links with optional
  password, expiry, download-limit, and watermark toggle.
* :class:`files.models.DownloadLog` — append-only audit row for every
  download (both authenticated and share-link).

Endpoints mount under ``/api/v1/files/``.
"""

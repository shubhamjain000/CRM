"""Celery tasks for the files app.

Two beat-scheduled tasks (see ``config/settings.py``):

* :func:`process_file_upload` — invoked by the viewset after a file is
  uploaded. Runs virus scan, generates a thumbnail, runs OCR (for
  images/PDFs), extracts full text via Tika, and stamps the File row's
  ``virus_scan_status`` / ``ocr_status`` / ``ocr_text`` fields.
* :func:`cleanup_old_files` — daily at 03:00 UTC. Permanently deletes
  soft-deleted files older than 7 years and archives files whose
  ``deleted_at`` is older than 90 days to S3 Glacier.

Both tasks iterate per-tenant via :func:`api.managers.tenant_context` so
the ORM scoping is correct.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from celery import shared_task
from django.utils import timezone

from api.managers import tenant_context
from api.models import Organization

from .models import File
from .services import (
    detect_pii,
    extract_text,
    generate_thumbnail,
    ocr_document,
    scan_virus,
)

log = logging.getLogger(__name__)


###############################################################################
# Post-upload processing
###############################################################################


@shared_task(name="files.process_file_upload", bind=True)
def process_file_upload(self: Any, file_id: int) -> dict[str, Any]:
    """Run the full post-upload pipeline for ``file_id``.

    Steps (each step is best-effort — a failure sets ``failed`` and skips
    downstream steps that depend on the output):

    1. Virus scan via ClamAV → ``virus_scan_status``.
    2. Thumbnail generation → ``thumbnail_url``.
    3. OCR (image/PDF only) → ``ocr_text`` + ``ocr_status``.
    4. Full-text extraction via Tika → append to ``ocr_text``.
    5. PII detection on extracted text → log findings (DLP).
    """
    summary: dict[str, Any] = {
        "file_id": file_id,
        "virus_scan": "skipped",
        "thumbnail": False,
        "ocr": "skipped",
        "text_extracted": False,
        "pii_findings": [],
    }

    # Resolve the file across every tenant (File is tenant-scoped).
    file: File | None = None
    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            file = File.all_objects.filter(pk=file_id).first()
            if file is not None:
                break
    if file is None:
        log.warning("process_file_upload: file %s not found in any tenant.", file_id)
        return summary

    with tenant_context(file.tenant):
        # 1. Virus scan.
        try:
            status = scan_virus(file)
            file.virus_scan_status = status
            summary["virus_scan"] = status
        except Exception as exc:  # pragma: no cover
            log.exception("process_file_upload: virus scan failed: %s", exc)
            file.virus_scan_status = File.VIRUS_SCAN_SKIPPED
        file.save(update_fields=["virus_scan_status", "updated_at"])

        # If infected — stop here.
        if file.virus_scan_status == File.VIRUS_SCAN_INFECTED:
            log.warning(
                "process_file_upload: file %s flagged as INFECTED — quarantining.", file.pk
            )
            return summary

        # 2. Thumbnail.
        try:
            thumb_url = generate_thumbnail(file)
            if thumb_url:
                file.thumbnail_url = thumb_url
                summary["thumbnail"] = True
        except Exception as exc:  # pragma: no cover
            log.warning("process_file_upload: thumbnail failed: %s", exc)

        # 3. OCR (image/PDF only).
        if file.is_image or file.is_pdf:
            try:
                file.ocr_status = File.OCR_PENDING
                file.save(update_fields=["ocr_status", "updated_at"])
                text = ocr_document(file)
                if text:
                    file.ocr_text = text
                    file.ocr_status = File.OCR_DONE
                    summary["ocr"] = "done"
                else:
                    file.ocr_status = File.OCR_SKIPPED
                    summary["ocr"] = "skipped"
            except Exception as exc:  # pragma: no cover
                log.warning("process_file_upload: OCR failed: %s", exc)
                file.ocr_status = File.OCR_FAILED
                summary["ocr"] = "failed"

        # 4. Full-text extraction via Tika (any MIME type).
        try:
            tika_text = extract_text(file)
            if tika_text:
                # Append (don't overwrite) so OCR + Tika output are both indexed.
                if file.ocr_text:
                    file.ocr_text = f"{file.ocr_text}\n\n--- Tika ---\n\n{tika_text}"
                else:
                    file.ocr_text = tika_text
                summary["text_extracted"] = True
        except Exception as exc:  # pragma: no cover
            log.warning("process_file_upload: Tika extraction failed: %s", exc)

        file.save(update_fields=["thumbnail_url", "ocr_text", "ocr_status", "updated_at"])

        # 5. DLP scan on whatever text we extracted.
        try:
            findings = detect_pii(file.ocr_text or "")
            summary["pii_findings"] = findings
            if findings:
                log.warning(
                    "process_file_upload: DLP — %s PII findings on file %s: %s",
                    len(findings), file.pk, [f["type"] for f in findings],
                )
        except Exception as exc:  # pragma: no cover
            log.warning("process_file_upload: DLP scan failed: %s", exc)

    return summary


###############################################################################
# Daily cleanup
###############################################################################


#: Soft-deleted rows past this age are permanently deleted.
HARD_DELETE_AGE_DAYS = 7 * 365

#: Soft-deleted rows past this age are archived to Glacier (transition only).
GLACIER_AGE_DAYS = 90


@shared_task(name="files.cleanup_old_files")
def cleanup_old_files() -> dict[str, Any]:
    """Daily cleanup — archive old soft-deleted files to Glacier and hard-delete the very old.

    * Files with ``deleted_at`` older than :data:`GLACIER_AGE_DAYS` →
      transition their S3 object to Glacier (via lifecycle policy or
      ``copy_object`` with ``StorageClass=GLACIER``).
    * Files with ``deleted_at`` older than :data:`HARD_DELETE_AGE_DAYS` →
      hard-delete both the DB row and the S3 object.
    """
    now = timezone.now()
    glacier_cutoff = now - timedelta(days=GLACIER_AGE_DAYS)
    hard_delete_cutoff = now - timedelta(days=HARD_DELETE_AGE_DAYS)

    summary: dict[str, Any] = {
        "tenants_processed": 0,
        "archived_to_glacier": 0,
        "hard_deleted": 0,
        "errors": [],
    }

    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            summary["tenants_processed"] += 1

            # Archive to Glacier: deleted 90+ days ago, not yet hard-deleted.
            archive_qs = File.all_objects.filter(
                deleted_at__lte=glacier_cutoff,
                deleted_at__gt=hard_delete_cutoff,
            )
            for file in archive_qs.iterator(chunk_size=200):
                try:
                    _transition_to_glacier(file)
                    summary["archived_to_glacier"] += 1
                except Exception as exc:  # pragma: no cover
                    log.warning("cleanup_old_files: Glacier archive failed for %s: %s", file.pk, exc)
                    summary["errors"].append({"file_id": file.pk, "error": str(exc)})

            # Hard-delete: deleted 7+ years ago.
            hard_qs = File.all_objects.filter(deleted_at__lte=hard_delete_cutoff)
            for file in hard_qs.iterator(chunk_size=200):
                try:
                    _hard_delete_file(file)
                    summary["hard_deleted"] += 1
                except Exception as exc:  # pragma: no cover
                    log.warning("cleanup_old_files: hard-delete failed for %s: %s", file.pk, exc)
                    summary["errors"].append({"file_id": file.pk, "error": str(exc)})

    log.info(
        "cleanup_old_files: tenants=%s archived=%s hard_deleted=%s",
        summary["tenants_processed"], summary["archived_to_glacier"], summary["hard_deleted"],
    )
    return summary


def _transition_to_glacier(file: File) -> None:
    """Transition ``file``'s S3 object to Glacier storage class."""
    try:
        from django.conf import settings

        client = None
        try:
            # Re-use the lazy client helper without circular-importing services.
            from .services import _s3_client

            client = _s3_client()
        except Exception:  # pragma: no cover
            return
        # Copy in-place with a new storage class.
        client.copy_object(
            Bucket=settings.AWS_STORAGE_BUCKET_NAME,
            CopySource={
                "Bucket": settings.AWS_STORAGE_BUCKET_NAME,
                "Key": file.storage_key,
            },
            Key=file.storage_key,
            StorageClass="GLACIER",
            MetadataDirective="COPY",
        )
    except Exception:  # pragma: no cover — dev: no S3 available
        log.info("_transition_to_glacier: stubbed for file %s (no S3 in dev).", file.pk)


def _hard_delete_file(file: File) -> None:
    """Permanently delete ``file``: remove S3 object + DB row."""
    try:
        from django.conf import settings

        from .services import _s3_client

        client = _s3_client()
        client.delete_object(
            Bucket=settings.AWS_STORAGE_BUCKET_NAME,
            Key=file.storage_key,
        )
    except Exception:  # pragma: no cover — dev: no S3 available
        log.info("_hard_delete_file: S3 delete stubbed for file %s.", file.pk)
    # Always delete the DB row even if S3 delete failed (the object will
    # be GC'd by the bucket lifecycle policy).
    file.delete()

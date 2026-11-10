"""Service layer for the files app.

External integrations
---------------------
* S3 / MinIO / R2 object storage via :func:`upload_to_storage` /
  :func:`generate_presigned_download` (boto3).
* Image thumbnail generation via Pillow (image resize), PyPDF2 (PDF first
  page → image), and ffmpeg (video frame) — all stubbed to no-op when the
  underlying tool isn't available so tests stay hermetic.
* PDF watermarking via PyPDF2 overlay.
* Apache Tika full-text extraction (HTTP call to a Tika server stubbed in
  dev via the ``TIKA_URL`` env var).
* ClamAV virus scan via the clamd protocol (stubbed when unavailable).
* Tesseract OCR via the pytesseract wrapper (stubbed when unavailable).
* Data-loss-prevention regex scan via :func:`detect_pii` — pure Python,
  used by the post-upload Celery task to flag SSNs / credit-card numbers /
  emails in OCR'd text.

All functions degrade gracefully in dev: missing tools / env vars are
logged but never raise — the calling Celery task records ``skipped`` /
``failed`` statuses on the File row.
"""

from __future__ import annotations

import io
import logging
import re
from typing import TYPE_CHECKING, Any

from django.conf import settings

if TYPE_CHECKING:  # pragma: no cover — typing only
    from files.models import File

log = logging.getLogger(__name__)


###############################################################################
# S3 / MinIO / R2 storage
###############################################################################


def _s3_client() -> Any:
    """Return a boto3 S3 client configured from Django settings.

    Lazily imported so the files app doesn't hard-require boto3 at import
    time (useful in unit tests that never touch storage).
    """
    import boto3  # type: ignore[import-untyped]

    return boto3.client(
        "s3",
        endpoint_url=settings.AWS_S3_ENDPOINT_URL or None,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID or None,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY or None,
    )


def upload_to_storage(file_obj: Any, key: str) -> None:
    """Upload ``file_obj`` (file-like) to S3/MinIO at ``key``.

    The bucket name comes from ``settings.AWS_STORAGE_BUCKET_NAME``. The
    ``Content-Type`` is inferred from the file object's ``content_type``
    attribute if present, otherwise left to S3's default
    (``application/octet-stream``).
    """
    client = _s3_client()
    content_type = getattr(file_obj, "content_type", None) or "application/octet-stream"
    client.upload_fileobj(
        Fileobj=file_obj,
        Bucket=settings.AWS_STORAGE_BUCKET_NAME,
        Key=key,
        ExtraArgs={"ContentType": content_type},
    )


def generate_presigned_download(key: str, expires: int = 3600) -> str:
    """Return a presigned S3 GET URL for ``key`` valid for ``expires`` seconds."""
    client = _s3_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.AWS_STORAGE_BUCKET_NAME, "Key": key},
        ExpiresIn=expires,
    )


###############################################################################
# Thumbnail generation
###############################################################################


def generate_thumbnail(file: "File") -> str:
    """Generate a thumbnail URL for ``file``.

    Strategy by MIME type:
      * image/* → resize to 200x200 via Pillow, upload to ``{key}-thumb.jpg``.
      * application/pdf → render first page via PyPDF2 → upload.
      * video/* → grab a frame via ffmpeg (stubbed).
      * anything else → return the empty string (no thumbnail).

    Returns the public/presigned thumbnail URL, or ``""`` on failure.
    """
    if not file.mime_type:
        return ""
    try:
        if file.is_image:
            return _thumbnail_image(file)
        if file.is_pdf:
            return _thumbnail_pdf(file)
        if file.is_video:
            return _thumbnail_video(file)
    except Exception as exc:  # pragma: no cover — defensive
        log.warning("generate_thumbnail: failed for file %s: %s", file.pk, exc)
    return ""


def _thumbnail_image(file: "File") -> str:
    """Resize the image to 200x200 and upload as a JPEG thumbnail."""
    try:
        from PIL import Image  # type: ignore[import-untyped]
    except ImportError:  # pragma: no cover — Pillow is optional in dev
        log.info("generate_thumbnail: Pillow not installed; skipping image thumbnail.")
        return ""
    client = _s3_client()
    obj = client.get_object(
        Bucket=settings.AWS_STORAGE_BUCKET_NAME,
        Key=file.storage_key,
    )
    with Image.open(obj["Body"]) as img:
        img.thumbnail((200, 200))
        buffer = io.BytesIO()
        img.convert("RGB").save(buffer, format="JPEG", quality=85)
        buffer.seek(0)
    thumb_key = f"{file.storage_key}-thumb.jpg"
    client.upload_fileobj(
        Fileobj=buffer,
        Bucket=settings.AWS_STORAGE_BUCKET_NAME,
        Key=thumb_key,
        ExtraArgs={"ContentType": "image/jpeg"},
    )
    return generate_presigned_download(thumb_key, expires=86400)


def _thumbnail_pdf(file: "File") -> str:
    """Render the first PDF page to an image and upload as a thumbnail.

    Uses PyPDF2 to extract the first page, then pdf2image (if available)
    to rasterize. Falls back to an empty string when pdf2image is missing.
    """
    try:
        import PyPDF2  # type: ignore[import-untyped]
    except ImportError:  # pragma: no cover
        log.info("generate_thumbnail: PyPDF2 not installed; skipping PDF thumbnail.")
        return ""
    try:
        from pdf2image import convert_from_bytes  # type: ignore[import-untyped]
    except ImportError:  # pragma: no cover
        log.info("generate_thumbnail: pdf2image not installed; skipping PDF thumbnail.")
        return ""
    client = _s3_client()
    obj = client.get_object(
        Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=file.storage_key
    )
    pdf_bytes = obj["Body"].read()
    reader = PyPDF2.PdfReader(io.BytesIO(pdf_bytes))
    if not reader.pages:
        return ""
    first_page_writer = PyPDF2.PdfWriter()
    first_page_writer.add_page(reader.pages[0])
    single_page_buf = io.BytesIO()
    first_page_writer.write(single_page_buf)
    images = convert_from_bytes(single_page_buf.getvalue(), size=200)
    if not images:
        return ""
    img = images[0]
    buffer = io.BytesIO()
    img.convert("RGB").save(buffer, format="JPEG", quality=85)
    buffer.seek(0)
    thumb_key = f"{file.storage_key}-thumb.jpg"
    client.upload_fileobj(
        Fileobj=buffer,
        Bucket=settings.AWS_STORAGE_BUCKET_NAME,
        Key=thumb_key,
        ExtraArgs={"ContentType": "image/jpeg"},
    )
    return generate_presigned_download(thumb_key, expires=86400)


def _thumbnail_video(file: "File") -> str:
    """Grab a frame from the video via ffmpeg.

    Stub: in production this would shell out to ``ffmpeg -ss 1 -i <presigned>
    -frames:v 1 -f image2 -``. We log and return ``""`` so the upload task
    doesn't fail when ffmpeg isn't installed.
    """
    log.info("generate_thumbnail: video thumbnail not implemented; skipping file %s", file.pk)
    return ""


###############################################################################
# PDF watermark
###############################################################################


def watermark_pdf(file_path: str, user_email: str) -> str:
    """Overlay a diagonal ``user_email`` watermark on every page of ``file_path``.

    Writes the watermarked copy to ``{file_path}.watermarked.pdf`` and
    returns the new path. Raises ``RuntimeError`` if PyPDF2 isn't
    available or the input isn't a valid PDF.
    """
    try:
        import PyPDF2  # type: ignore[import-untyped]
        from reportlab.lib.pagesizes import letter  # type: ignore[import-untyped]
        from reportlab.pdfgen import canvas  # type: ignore[import-untyped]
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("PyPDF2 + reportlab required for PDF watermarking.") from exc

    overlay_buf = io.BytesIO()
    c = canvas.Canvas(overlay_buf, pagesize=letter)
    c.saveState()
    c.setFont("Helvetica", 24)
    c.setFillAlpha(0.3)
    c.translate(200, 200)
    c.rotate(45)
    c.drawCentredString(0, 0, user_email)
    c.restoreState()
    c.showPage()
    c.save()
    overlay_buf.seek(0)
    overlay_reader = PyPDF2.PdfReader(overlay_buf)
    overlay_page = overlay_reader.pages[0]

    with open(file_path, "rb") as fh:
        reader = PyPDF2.PdfReader(fh)
        writer = PyPDF2.PdfWriter()
        for page in reader.pages:
            page.merge_page(overlay_page)
            writer.add_page(page)
        out_path = f"{file_path}.watermarked.pdf"
        with open(out_path, "wb") as out_fh:
            writer.write(out_fh)
    return out_path


###############################################################################
# Full-text extraction (Apache Tika)
###############################################################################


def extract_text(file: "File") -> str:
    """Extract full text from ``file`` via Apache Tika.

    Calls the Tika server at ``settings.TIKA_URL`` (default ``http://tika:9998``)
    with the file's presigned URL. Returns the extracted plain text, or
    ``""`` on failure.
    """
    import requests  # type: ignore[import-untyped]

    tika_url = getattr(settings, "TIKA_URL", "http://tika:9998")
    try:
        url = generate_presigned_download(file.storage_key, expires=300)
        response = requests.put(
            f"{tika_url}/tika",
            data=url.encode("utf-8"),
            headers={"Accept": "text/plain", "Content-Type": "text/plain"},
            timeout=60,
        )
        response.raise_for_status()
        return response.text
    except Exception as exc:  # pragma: no cover — depends on Tika availability
        log.warning("extract_text: Tika call failed for file %s: %s", file.pk, exc)
        return ""


###############################################################################
# Virus scan (ClamAV)
###############################################################################


def scan_virus(file: "File") -> str:
    """ClamAV virus scan. Returns one of ``clean`` / ``infected`` / ``skipped``.

    Tries the clamd TCP socket at ``settings.CLAMAV_HOST`` (default
    ``clamav:3310``). Falls back to ``skipped`` when clamd isn't reachable
    so uploads don't block in dev.
    """
    try:
        import clamd  # type: ignore[import-untyped]
    except ImportError:  # pragma: no cover
        log.info("scan_virus: clamd module not installed; skipping file %s", file.pk)
        return "skipped"
    host = getattr(settings, "CLAMAV_HOST", "clamav")
    port = int(getattr(settings, "CLAMAV_PORT", "3310"))
    try:
        cd = clamd.ClamdNetworkTrackingClient(host=host, port=port)  # type: ignore[attr-defined]
        client = _s3_client()
        obj = client.get_object(
            Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=file.storage_key
        )
        result = cd.instream(obj["Body"])
        status = result.get("stream", [None])[0]
        if status == "OK":
            return "clean"
        if status == "FOUND":
            log.warning("scan_virus: file %s infected! %s", file.pk, result)
            return "infected"
        return "skipped"
    except Exception as exc:  # pragma: no cover
        log.warning("scan_virus: ClamAV scan failed for file %s: %s", file.pk, exc)
        return "skipped"


###############################################################################
# OCR (Tesseract)
###############################################################################


def ocr_document(file: "File") -> str:
    """Tesseract OCR over an image/PDF file. Returns the extracted text.

    Returns ``""`` when tesseract / pytesseract isn't available so the
    upload task records ``skipped`` instead of failing.
    """
    try:
        import pytesseract  # type: ignore[import-untyped]
        from PIL import Image  # type: ignore[import-untyped]
    except ImportError:  # pragma: no cover
        log.info("ocr_document: tesseract/PIL not installed; skipping file %s", file.pk)
        return ""
    if not (file.is_image or file.is_pdf):
        return ""
    try:
        client = _s3_client()
        obj = client.get_object(
            Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=file.storage_key
        )
        with Image.open(obj["Body"]) as img:
            return pytesseract.image_to_string(img)
    except Exception as exc:  # pragma: no cover
        log.warning("ocr_document: OCR failed for file %s: %s", file.pk, exc)
        return ""


###############################################################################
# Data-loss-prevention (DLP) PII detection
###############################################################################


#: Visa / Mastercard / Amex / Discover (basic Luhn-not-validated pattern).
_CREDIT_CARD_RE = re.compile(
    r"\b(?:\d[ -]*?){13,16}\b"
)

#: US Social Security Numbers (``XXX-XX-XXXX``).
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")

#: Email addresses (RFC 5322 simplified).
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")


def detect_pii(text: str) -> list[dict[str, str]]:
    """Scan ``text`` for PII patterns and return a list of findings.

    Each finding is ``{"type": "credit_card"|"ssn"|"email", "value": <match>}``.
    Credit-card numbers are *not* Luhn-validated — the caller is expected
    to do that for high-confidence matches.
    """
    if not text:
        return []
    findings: list[dict[str, str]] = []
    for match in _CREDIT_CARD_RE.finditer(text):
        findings.append({"type": "credit_card", "value": match.group(0)})
    for match in _SSN_RE.finditer(text):
        findings.append({"type": "ssn", "value": match.group(0)})
    for match in _EMAIL_RE.finditer(text):
        findings.append({"type": "email", "value": match.group(0)})
    return findings

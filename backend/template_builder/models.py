"""Database models for the template_builder app (Phase 17).

Two tenant-scoped models:

* :class:`EmailTemplate` — name / subject / body_html / category.
* :class:`PdfTemplate` — name / html_template / css / category. The
  category is one of ``quote`` / ``invoice`` / ``contract`` /
  ``proposal``.

Both templates are rendered with Django's template engine via
:func:`template_builder.services.render_html`.
"""

from __future__ import annotations

from django.db import models

from api.models import TenantModel

###############################################################################
# Constants — PDF categories
###############################################################################

PDF_QUOTE = "quote"
PDF_INVOICE = "invoice"
PDF_CONTRACT = "contract"
PDF_PROPOSAL = "proposal"
PDF_CATEGORY_CHOICES = [
    (PDF_QUOTE, "Quote"),
    (PDF_INVOICE, "Invoice"),
    (PDF_CONTRACT, "Contract"),
    (PDF_PROPOSAL, "Proposal"),
]


###############################################################################
# EmailTemplate
###############################################################################


class EmailTemplate(TenantModel):
    """A reusable email template (subject + body_html)."""

    name = models.CharField(max_length=100, db_index=True)
    subject = models.CharField(max_length=255)
    body_html = models.TextField()
    category = models.CharField(max_length=50, blank=True, default="")

    class Meta:
        db_table = "template_builder_email"
        verbose_name = "email template"
        verbose_name_plural = "email templates"
        unique_together = (("tenant", "name"),)
        indexes = [
            models.Index(fields=["tenant", "category"], name="email_tmpl_cat_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.subject})"


###############################################################################
# PdfTemplate
###############################################################################


class PdfTemplate(TenantModel):
    """A reusable PDF template (html_template + css + category).

    The PDF render pipeline (HTML → Playwright → PDF) runs on the
    async-worker side; this model only stores the template source.
    """

    name = models.CharField(max_length=100, db_index=True)
    html_template = models.TextField()
    css = models.TextField(blank=True, default="")
    category = models.CharField(
        max_length=32, choices=PDF_CATEGORY_CHOICES, default=PDF_QUOTE, db_index=True
    )

    class Meta:
        db_table = "template_builder_pdf"
        verbose_name = "pdf template"
        verbose_name_plural = "pdf templates"
        unique_together = (("tenant", "name"),)
        indexes = [
            models.Index(fields=["tenant", "category"], name="pdf_tmpl_cat_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.category})"


__all__ = [
    "EmailTemplate",
    "PDF_CATEGORY_CHOICES",
    "PDF_CONTRACT",
    "PDF_INVOICE",
    "PDF_PROPOSAL",
    "PDF_QUOTE",
    "PdfTemplate",
]

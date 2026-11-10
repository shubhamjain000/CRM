"""Root URL configuration."""
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView

from api.openapi import get_openapi_schema
from api.saml_views import saml_urlpatterns
from api.scim import scim_urlpatterns
from api.views import health


def openapi_json(_request):  # type: ignore[no-untyped-def]
    """Serve the static OpenAPI 3.1 schema (used by frontend codegen)."""
    return JsonResponse(get_openapi_schema(), json=False, safe=False)


urlpatterns = [
    path("admin/", admin.site.urls),
    # Top-level liveness probe (also available at /api/health/ via api.urls).
    path("health/", health, name="health-root"),
    # Auth + account endpoints under /api/.
    path("api/", include("api.urls")),
    # CRM endpoints (Phase 3) — each app's urls.py registers its own router
    # prefix (e.g. ``accounts/``), so we mount them all under /api/v1/.
    path("api/v1/", include("accounts.urls")),
    path("api/v1/", include("contacts.urls")),
    path("api/v1/", include("leads.urls")),
    path("api/v1/", include("deals.urls")),
    path("api/v1/", include("custom_fields.urls")),
    # CRM UX layer (Phase 4) — saved views, recently-viewed, activities, notes,
    # file attachments, record locks, trash, and the merged timeline endpoint.
    path("api/v1/", include("crm_ux.urls")),
    # Productivity apps (Phase 5) — tasks, events, calls.
    path("api/v1/", include("tasks.urls")),
    path("api/v1/", include("events.urls")),
    path("api/v1/", include("calls.urls")),
    # Content apps (Phase 6) — notes, files, attachments.
    path("api/v1/", include("notes.urls")),
    path("api/v1/", include("files.urls")),
    path("api/v1/", include("attachments.urls")),
    # Real-time fabric (Phase 7) — activity feed, notifications.
    # WebSocket routes are mounted directly by ``config/asgi.py`` (URLRouter)
    # and are NOT registered here.
    path("api/v1/", include("feed.urls")),
    path("api/v1/", include("notifications.urls")),
    # Blueprint engine (Phase 9) — Zoho-Blueprint-equivalent state machine
    # layered on top of the Phase-8 pipeline graph.
    path("api/v1/", include("blueprint.urls")),
    # Rule engine (Phase 10) — approvals, validation_rules, assignment_rules,
    # escalation_rules.
    path("api/v1/", include("approvals.urls")),
    path("api/v1/", include("validation_rules.urls")),
    path("api/v1/", include("assignment_rules.urls")),
    path("api/v1/", include("escalation_rules.urls")),
    # Workflow automation engine (Phase 11) — workflow rules + actions +
    # execution audit trail, plus cron-driven scheduled jobs.
    path("api/v1/", include("workflows.urls")),
    path("api/v1/", include("scheduled_actions.urls")),
    # Custom functions scripting engine (Phase 12) — RestrictedPython-sandboxed
    # Python / JavaScript snippets with CRM / HTTP / KV API surface, versioning,
    # admin-approval gate, webhook invocation.
    path("api/v1/", include("custom_functions.urls")),
    # Email integration + telephony (Phase 13) — connected mailboxes (IMAP/
    # SMTP/Exchange) with threading + tracking + mail-merge, plus multi-provider
    # (Twilio / Exotel / Vonage / Plivo / MSG91) phone numbers, call logging
    # with transcription + sentiment, SMS templates with DLT compliance, IVR.
    path("api/v1/", include("email_integration.urls")),
    path("api/v1/", include("telephony.urls")),
    # Omnichannel apps (Phase 14) — WhatsApp Business API (outbound send +
    # inbound webhook ingest + templates + broadcasts), real-time live chat
    # with WebSocket consumer, social mentions + scheduled posts, and the
    # unified inbox that aggregates every channel into a single conversation
    # surface with SLA tracking, macros, and analytics.
    path("api/v1/", include("whatsapp.urls")),
    path("api/v1/", include("livechat.urls")),
    path("api/v1/", include("social.urls")),
    path("api/v1/", include("inbox.urls")),
    # Reports + analytics (Phase 15) — report builder with 16 chart types,
    # CSV/XLSX/PDF/JSON export, sharing, subscriptions, scheduling; plus
    # pre-built analytics dashboards (sales funnel, win/loss, lead
    # conversion, sales cycle, deal-size distribution, rep performance,
    # activity heatmap, pipeline velocity, source ROI, email engagement,
    # call analytics, cohort retention).
    path("api/v1/", include("reports.urls")),
    # Dashboards + forecasting + goals (Phase 16) — dashboard builder
    # with 9 widget types + 5 pre-built templates, rep/manager
    # forecasting with submit/approve workflow + accuracy tracking, and
    # gamified goals + leaderboards + achievement badges. Registered
    # BEFORE analytics.urls so the new dashboards endpoints (which use
    # the same ``dashboards/`` prefix as the Phase-15 analytics
    # dashboard router) take precedence.
    path("api/v1/", include("dashboards.urls")),
    path("api/v1/", include("forecasting.urls")),
    path("api/v1/", include("goals.urls")),
    path("api/v1/", include("analytics.urls")),
    # Platform customization (Phase 17) — custom modules (user-defined
    # CRM objects), page layouts (sections + field placement per
    # module + profile), permission profiles (CRUD + field-level
    # access matrix), territories (geo/vertical assignment with
    # realign), canvas theming (singleton per-org white-label),
    # configuration sandboxes (snapshot + branch + compare + push-to-
    # production), and a template builder (email + PDF templates with
    # preview + render).
    path("api/v1/", include("custom_modules.urls")),
    path("api/v1/", include("layouts.urls")),
    path("api/v1/", include("profiles.urls")),
    path("api/v1/", include("territories.urls")),
    path("api/v1/", include("canvas.urls")),
    path("api/v1/", include("sandbox.urls")),
    path("api/v1/", include("template_builder.urls")),
    # AI layer (Phase 18) — central orchestrator (ai_core) + 9 AI apps:
    # lead scoring, deal prediction, anomaly detection, sentiment
    # analysis, smart suggestions, NLP queries, Zia chatbot, AI writer,
    # autonomous AI agents. ai_core is mounted first because the other
    # apps lazy-import ai_core.services.call_llm.
    path("api/v1/", include("ai_core.urls")),
    path("api/v1/", include("lead_scoring.urls")),
    path("api/v1/", include("deal_prediction.urls")),
    path("api/v1/", include("anomaly_detection.urls")),
    path("api/v1/", include("sentiment_analysis.urls")),
    path("api/v1/", include("smart_suggestions.urls")),
    path("api/v1/", include("nlp_queries.urls")),
    path("api/v1/", include("zia_chatbot.urls")),
    path("api/v1/", include("ai_writer.urls")),
    path("api/v1/", include("ai_agents.urls")),
    # Ecosystem apps (Phase 19) — marketplace (extension catalog + per-
    # tenant installs), invoicing (invoices / estimates / payments),
    # support (tickets / replies / KB), projects (projects / tasks /
    # time entries), marketing (campaigns / subscriber lists / emails),
    # hr (employees / leave / expenses), native_integrations (third-
    # party provider connections with audit log).
    path("api/v1/", include("marketplace.urls")),
    path("api/v1/", include("invoicing.urls")),
    path("api/v1/", include("support.urls")),
    path("api/v1/", include("projects.urls")),
    path("api/v1/", include("marketing.urls")),
    path("api/v1/", include("hr.urls")),
    path("api/v1/", include("native_integrations.urls")),
    # Security + compliance apps (Phase 20) — audit (immutable audit log
    # with per-record filter), access_control (IP allowlist / session
    # policy / trusted devices), data_security (classification + retention
    # policies), compliance (frameworks + checklists + consent registry +
    # report), backup (backup records + restore stub), security_monitoring
    # (security events + alerts with acknowledge).
    path("api/v1/", include("audit.urls")),
    path("api/v1/", include("access_control.urls")),
    path("api/v1/", include("data_security.urls")),
    path("api/v1/", include("compliance.urls")),
    path("api/v1/", include("backup.urls")),
    path("api/v1/", include("security_monitoring.urls")),
    # SCIM 2.0 (consumed by IdPs).
    *scim_urlpatterns(),
    # SAML 2.0 SP.
    *saml_urlpatterns(),
    # OAuth providers via django-allauth (Google/Microsoft/Apple/GitHub/LinkedIn).
    path("accounts/", include("allauth.urls")),
    # OpenAPI 3.1 schema for frontend openapi-typescript codegen (static, hand-curated).
    path("openapi.json", openapi_json, name="openapi-schema"),
    # drf-spectacular — auto-generated OpenAPI 3.1 + Swagger/ReDoc UIs.
    path("api/schema/", SpectacularAPIView.as_view(), name="api-schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="api-schema"), name="api-docs"),
    path("api/redoc/", SpectacularRedocView.as_view(url_name="api-schema"), name="api-redoc"),
]

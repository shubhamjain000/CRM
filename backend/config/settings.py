"""Django settings for the Foundation backend (Phase 10 — rule engine)."""
import os
from datetime import timedelta
from pathlib import Path

from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-insecure-change-me")
DEBUG = os.environ.get("DJANGO_DEBUG", "True").lower() == "true"
ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "localhost,backend").split(",")

# Multi-tenancy: tenant is resolved per-request from subdomain / session /
# ``X-Organization`` header. The middleware binds it as a thread-local.
TENANT_COOKIE_DOMAIN = os.environ.get("TENANT_COOKIE_DOMAIN", "")
FIELD_ENCRYPTION_KEY = os.environ.get("FIELD_ENCRYPTION_KEY", "")

###############################################################################
# Apps
###############################################################################

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Channels — Daphne is at the top so it claims the runserver command;
    # ``channels`` itself provides the routing / channel-layer plumbing.
    "channels",
    # DRF + JWT
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    # Auth
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
    "allauth.socialaccount.providers.microsoft",
    "allauth.socialaccount.providers.apple",
    "allauth.socialaccount.providers.github",
    "allauth.socialaccount.providers.linkedin",
    "allauth.usersessions",  # required by allauth for proper logout tracking
    "axes",
    "guardian",
    # Multi-tenancy / RLS / SCIM / SAML handled in api app code.
    "django_celery_beat",
    "django_filters",
    # CRM apps (Phase 3).
    "accounts",
    "contacts",
    "leads",
    "deals",
    "custom_fields",
    # CRM UX layer (Phase 4): saved views, recently-viewed, activities, notes,
    # file attachments, record locks, trash management.
    "crm_ux",
    # Productivity apps (Phase 5): tasks, events, calls.
    "tasks",
    "events",
    "calls",
    # Content apps (Phase 6): notes, files, attachments.
    "notes",
    "files",
    "attachments",
    # Real-time fabric (Phase 7): activity feed, notifications, WebSocket layer.
    "feed",
    "notifications",
    "realtime",
    # Blueprint engine (Phase 9): Zoho-Blueprint-equivalent state machine
    # layered on top of the Phase-8 pipeline graph.
    "blueprint",
    # Rule engine (Phase 10): approvals, validation_rules, assignment_rules,
    # escalation_rules. approvals owns the canonical ApprovalProcess model
    # (promoted from the Phase-8 deals stub); the others are tenant-scoped
    # rule sets evaluated by signals + Celery beat tasks.
    "approvals",
    "validation_rules",
    "assignment_rules",
    "escalation_rules",
    # Workflow automation engine (Phase 11): workflows (rule + action + execution)
    # + scheduled_actions (cron-driven recurring jobs re-using the workflow
    # action dispatch table).
    "workflows",
    "scheduled_actions",
    # Custom functions scripting engine (Phase 12): tenant-scoped Python /
    # JavaScript snippets running inside a RestrictedPython sandbox with a
    # curated CRM / HTTP / KV / email / SMS API surface. Versioned + admin-
    # approval-gated + audited via CustomFunctionExecution rows.
    "custom_functions",
    # Email integration (Phase 13): IMAP sync, SMTP send, threading,
    # open/click/bounce tracking, schedule-send + undo-send, mail-merge
    # campaigns. EmailAccount / EmailThread / Email / EmailSignature /
    # EmailTracking / MailMergeCampaign.
    "email_integration",
    # Telephony (Phase 13): multi-provider (Twilio / Exotel / Vonage / Plivo /
    # MSG91) phone numbers, call logging with transcription + sentiment,
    # SMS templates with DLT compliance, IVR flow definitions.
    "telephony",
    # Omnichannel (Phase 14): WhatsApp Business API, live chat with WebSocket
    # real-time, social (Twitter / LinkedIn / Facebook / Instagram) mentions
    # + scheduled posts, and the unified inbox that aggregates all channels
    # (email / WhatsApp / telephony / livechat / social / SMS) into a single
    # conversation surface with SLA tracking, macros, and analytics.
    "whatsapp",
    "livechat",
    "social",
    "inbox",
    # Reports + analytics (Phase 15): report builder with 16 chart types,
    # pre-built analytics dashboards, CSV/Excel/PDF/JSON export, sharing,
    # subscriptions, and cron-driven scheduled e-mail delivery.
    "reports",
    "analytics",
    # Dashboards + forecasting + goals (Phase 16): dashboard builder with
    # 9 widget types + 5 pre-built templates (Sales Manager / Sales Rep /
    # Marketing / Customer Success / Executive), rep + manager forecasting
    # with submission/approval workflow and accuracy tracking, and
    # gamified goals + leaderboards + achievement badges.
    "dashboards",
    "forecasting",
    "goals",
    # Phase 17 — platform customization: custom modules (user-defined
    # CRM objects), page layouts (sections + field placement per
    # module + profile), permission profiles (CRUD + field-level
    # access matrix), territories (geo/vertical assignment with
    # realign), canvas theming (singleton per-org white-label), config
    # sandboxes (snapshot + branch + compare + push-to-production),
    # and a template builder (email + PDF templates with preview +
    # render).
    "custom_modules",
    "layouts",
    "profiles",
    "territories",
    "canvas",
    "sandbox",
    "template_builder",
    # Phase 18 — AI layer: central orchestrator (ai_core) + 9 AI apps
    # — lead_scoring, deal_prediction, anomaly_detection,
    # sentiment_analysis, smart_suggestions, nlp_queries, zia_chatbot,
    # ai_writer, ai_agents. ai_core is registered first because every
    # other AI app lazy-imports ai_core.services.call_llm.
    "ai_core",
    "lead_scoring",
    "deal_prediction",
    "anomaly_detection",
    "sentiment_analysis",
    "smart_suggestions",
    "nlp_queries",
    "zia_chatbot",
    "ai_writer",
    "ai_agents",
    # Phase 19 — ecosystem apps: marketplace (extension catalog +
    # per-tenant installs), invoicing (invoices / estimates / payments),
    # support (tickets / replies / KB), projects (projects / tasks /
    # time entries), marketing (campaigns / subscriber lists /
    # marketing emails), hr (employees / leave / expenses), and
    # native_integrations (third-party provider connections with audit
    # log). All seven are tenant-scoped (except marketplace.Extension
    # which is global-catalog) and use the established TenantModel base.
    "marketplace",
    "invoicing",
    "support",
    "projects",
    "marketing",
    "hr",
    "native_integrations",
    # Phase 20 — security + compliance apps: audit (immutable audit log
    # with field-level diff), access_control (IP allowlist / session
    # policy / trusted devices), data_security (data classification +
    # retention policies), compliance (frameworks / checklists / consent
    # registry + report), backup (tenant backup records + restore stub),
    # security_monitoring (security events + alerts with acknowledge).
    "audit",
    "access_control",
    "data_security",
    "compliance",
    "backup",
    "security_monitoring",
    # Seed demo-data command.
    "seed",
    "api",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # allauth requires AccountMiddleware in 0.54+.
    "allauth.account.middleware.AccountMiddleware",
    # Axes must come *after* AuthenticationMiddleware so it can inspect the user.
    "axes.middleware.AxesMiddleware",
    # TenantMiddleware binds request.tenant + thread-local tenant_context.
    "api.middleware.TenantMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "foundation"),
        "USER": os.environ.get("DB_USER", "foundation"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "foundation"),
        "HOST": os.environ.get("DB_HOST", "postgres"),
        "PORT": os.environ.get("DB_PORT", "5432"),
    }
}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": os.environ.get("REDIS_URL", "redis://redis:6379/0"),
    }
}

CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://redis:6379/1")
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_TIMEZONE = "UTC"

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [os.environ.get("REDIS_URL", "redis://redis:6379/0")]},
    }
}

# Storage (MinIO / S3 in dev, S3 in prod).
STORAGES = {
    "default": {
        "BACKEND": "storages.backends.s3.S3Storage",
    },
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}
AWS_STORAGE_BUCKET_NAME = os.environ.get("S3_BUCKET", "foundation-media")
AWS_S3_ENDPOINT_URL = os.environ.get("S3_ENDPOINT", "http://minio:9000")
AWS_ACCESS_KEY_ID = os.environ.get("S3_ACCESS_KEY", "foundation")
AWS_SECRET_ACCESS_KEY = os.environ.get("S3_SECRET_KEY", "foundation123")
AWS_S3_REGION_NAME = os.environ.get("AWS_S3_REGION_NAME", "us-east-1")
AWS_S3_SIGNATURE_VERSION = os.environ.get("AWS_S3_SIGNATURE_VERSION", "s3v4")
AWS_S3_FILE_OVERWRITE = False
AWS_QUERYSTRING_AUTH = True  # presign URLs so private buckets work
AWS_IS_GZIPPED = True
AWS_S3_OBJECT_PARAMETERS = {
    "CacheControl": "max-age=86400",
}
DEFAULT_FILE_STORAGE = "storages.backends.s3.S3Storage"

# ClamAV virus-scanner endpoint (used by files.services.scan_virus).
CLAMAV_HOST = os.environ.get("CLAMAV_HOST", "clamav")
CLAMAV_PORT = os.environ.get("CLAMAV_PORT", "3310")

# Apache Tika full-text extraction endpoint (used by files.services.extract_text).
TIKA_URL = os.environ.get("TIKA_URL", "http://tika:9998")

# Meilisearch
MEILI_URL = os.environ.get("MEILI_URL", "http://meilisearch:7700")
MEILI_MASTER_KEY = os.environ.get("MEILI_MASTER_KEY", "")

###############################################################################
# Real-time fabric (Phase 7)
###############################################################################

# Channels — ASGI application + Redis-backed channel layer. ``ASGI_APPLICATION``
# is set above (line 115) and ``CHANNEL_LAYERS`` immediately below the cache
# config. Both are reused by the Phase 7 ``realtime`` app: the channel layer
# multiplexes every WebSocket consumer + every server-side broadcast onto the
# same Redis cluster the cache uses.

# Maximum concurrent WebSocket connections per user — enforced in
# ``realtime.consumers.RealtimeConsumer.connect``.
REALTIME_MAX_CONNECTIONS_PER_USER = int(
    os.environ.get("REALTIME_MAX_CONNECTIONS_PER_USER", "5")
)

# Web Push (VAPID) — used by ``notifications.services.send_push_notification``.
# Generate with: ``npx web-push generate-vapid-keys`` (Node) or
# ``pywebpush -g`` (Python). Both the public + private keys MUST be set in
# production; the helpers no-op when unset.
PUSH_VAPID_SUBJECT = os.environ.get("PUSH_VAPID_SUBJECT", "mailto:noreply@foundation.local")
PUSH_VAPID_PUBLIC_KEY = os.environ.get("PUSH_VAPID_PUBLIC_KEY", "")
PUSH_VAPID_PRIVATE_KEY = os.environ.get("PUSH_VAPID_PRIVATE_KEY", "")

# Twilio (SMS — urgent notifications only). The helpers no-op when unset.
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER = os.environ.get("TWILIO_FROM_NUMBER", "")

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
CSRF_TRUSTED_ORIGINS = os.environ.get("CSRF_TRUSTED_ORIGINS", "http://localhost:3000").split(",")

DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "no-reply@foundation.local")
EMAIL_BACKEND = os.environ.get("EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = os.environ.get("EMAIL_HOST", "mailhog")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "1025"))

###############################################################################
# Custom user model & auth backends
###############################################################################

AUTH_USER_MODEL = "api.User"

AUTHENTICATION_BACKENDS = [
    # AxesStandaloneBackend must be first so axes tracks login attempts.
    "axes.backends.AxesStandaloneBackend",
    # django-allauth social auth (Google/Microsoft/Apple/GitHub/LinkedIn).
    "allauth.account.auth_backends.AuthenticationBackend",
    # Default Django auth — fine for admin and password login.
    "django.contrib.auth.backends.ModelBackend",
    # Object-level permissions (django-guardian).
    "guardian.backends.ObjectPermissionBackend",
]

###############################################################################
# Django REST Framework
###############################################################################

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_VERSIONING_CLASS": "rest_framework.versioning.NamespaceVersioning",
    "DEFAULT_PAGINATION_CLASS": "api.crm_base.CRMCursorPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
        "rest_framework.filters.SearchFilter",
    ),
    "EXCEPTION_HANDLER": "rest_framework.views.exception_handler",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Foundation Platform API",
    "DESCRIPTION": (
        "Multi-tenant enterprise CRM backend — auth, accounts, contacts, leads, "
        "deals, pipelines, custom fields (Phase 3) + UX layer: saved views, "
        "recently-viewed, activities, notes, files, locks, trash (Phase 4) + "
        "productivity: tasks, events, calls (Phase 5) + content: collaborative "
        "notes, S3-backed files, attachments (Phase 6) + real-time fabric: "
        "activity feed, notifications, WebSocket presence / cursors (Phase 7) + "
        "pipeline engine: stage transitions, DealStageHistory, PipelineService "
        "(Phase 8) + blueprint engine: Blueprint, BlueprintState, "
        "BlueprintTransition, BlueprintExecution (Phase 9) + rule engine: "
        "approvals, validation_rules, assignment_rules, escalation_rules (Phase 10)."
        " + platform customization (Phase 17): custom_modules, layouts, "
        "profiles, territories, canvas, sandbox, template_builder."
        " + AI layer (Phase 18): ai_core (LLM orchestrator + cost ledger + "
        "prompt templates), lead_scoring, deal_prediction, anomaly_detection, "
        "sentiment_analysis, smart_suggestions, nlp_queries, zia_chatbot, "
        "ai_writer, ai_agents."
    ),
    "VERSION": "0.18.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": "/api/v1/",
    "TAGS": [
        {"name": "auth", "description": "Authentication & identity."},
        {"name": "accounts", "description": "CRM accounts."},
        {"name": "contacts", "description": "CRM contacts."},
        {"name": "leads", "description": "CRM leads + lead conversion."},
        {"name": "deals", "description": "CRM deals + pipelines + stages."},
        {"name": "custom_fields", "description": "Per-tenant custom field definitions & values."},
        {"name": "crm_ux", "description": "UX layer: saved views, recently-viewed, activities, notes, files, locks, trash."},
        {"name": "tasks", "description": "Productivity tasks with RRULE recurrence, reminders, and timers."},
        {"name": "events", "description": "Calendar events + meetings with ICS export, conflict detection, RSVP."},
        {"name": "calls", "description": "VoIP call logging with transcription + sentiment."},
        {"name": "notes", "description": "Collaborative rich-text notes with mentions, hashtags, sharing, comments, version history."},
        {"name": "files", "description": "S3-backed file storage with versioning, virus scan, OCR, DLP, watermark."},
        {"name": "attachments", "description": "Polymorphic join between CRM records and files; bulk ZIP download."},
        {"name": "feed", "description": "Tenant activity feed (posts, comments, reactions) with mentions + hashtags."},
        {"name": "notifications", "description": "In-app / email / push / SMS notifications + preferences + quiet hours."},
        {"name": "realtime", "description": "WebSocket layer (Django Channels) — presence, cursors, typing, live record updates."},
        {"name": "blueprint", "description": "Zoho-Blueprint-equivalent state machine layered on top of the deals pipeline."},
        {"name": "approvals", "description": "Multi-step approval workflow engine (ApprovalProcess, ApprovalStep, ApprovalRequest, ApprovalAction, ApprovalDelegation)."},
        {"name": "validation_rules", "description": "Tenant-scoped field validators (required / regex / range / unique / custom) fired on Lead / Contact / Account / Deal pre_save."},
        {"name": "assignment_rules", "description": "Auto-assign records to users via round-robin / lead-balance / territory / custom strategies."},
        {"name": "escalation_rules", "description": "Auto-escalate records that breach an SLA (reassign / notify / both)."},
        {"name": "workflows", "description": "Workflow automation engine — WorkflowRule + 18 action types + WorkflowExecution audit trail."},
        {"name": "scheduled_actions", "description": "Cron-driven recurring jobs that re-use the workflow action dispatch table."},
        {"name": "custom_functions", "description": "Tenant-scoped Python / JavaScript scripts executed in a RestrictedPython sandbox with a CRM / HTTP / KV API surface; versioned, admin-approval-gated, webhook-invokable."},
        {"name": "email_integration", "description": "Connected mailboxes (IMAP/SMTP/Exchange) with threading, open/click/bounce tracking, schedule-send + undo-send, mail-merge campaigns."},
        {"name": "telephony", "description": "Multi-provider (Twilio / Exotel / Vonage / Plivo / MSG91) phone numbers, call logging with transcription + sentiment, SMS templates with DLT compliance, IVR flows."},
        {"name": "whatsapp", "description": "WhatsApp Business API — outbound send, inbound webhook ingest, pre-approved templates, broadcasts."},
        {"name": "livechat", "description": "Real-time live chat — visitor sessions, agent assignment, canned responses, proactive rules, WebSocket consumer."},
        {"name": "social", "description": "Social media (Twitter / LinkedIn / Facebook / Instagram) mentions, scheduled posts, keyword-stub sentiment, assignment + response tracking."},
        {"name": "inbox", "description": "Unified inbox — cross-channel conversations (email / WhatsApp / telephony / livechat / social / SMS), SLA monitoring, macros, analytics."},
        {"name": "reports", "description": "Report builder — source-model-backed query engine (8 sources), 7 report types, 11 chart types + none, AND/OR filter tree, group-by + 6 aggregates, HAVING, CSV/XLSX/PDF/JSON export, sharing, subscriptions, cron scheduling."},
        {"name": "analytics", "description": "Pre-built analytics dashboards — 12 sales / activity datasets (funnel, win/loss, lead conversion, sales cycle, deal-size distribution, rep performance, activity heatmap, pipeline velocity, source ROI, email engagement, call analytics, cohort retention)."},
        {"name": "dashboards", "description": "Dashboard builder — 9 widget types (kpi / chart / table / gauge / leaderboard / funnel / progress / counter / iframe), GridStack positions, refresh interval, sharing, default flag, 5 pre-built templates (Sales Manager / Sales Rep / Marketing / Customer Success / Executive)."},
        {"name": "forecasting", "description": "Rep + manager forecasting — 5 categories (pipeline / best_case / commit / closed / omitted), 4 period types (weekly / monthly / quarterly / yearly), auto-calc from deals, manual overrides + audit trail, submit/approve workflow, team roll-up, accuracy tracking, best/worst/most-likely scenarios."},
        {"name": "goals", "description": "Targets + gamification — user/team/org-scoped goals on 7 metrics (revenue / deals_closed / calls_made / emails_sent / meetings_held / leads_created / custom) over 5 periods (daily / weekly / monthly / quarterly / yearly), daily-refresh actuals via Celery beat, leaderboards, 4 achievement badges (first_deal / 100k_deals / 100_calls_week / top_performer_month)."},
        {"name": "custom_modules", "description": "User-defined CRM modules (CustomObject-equivalent) — module + field schema + generic record storage with validation."},
        {"name": "layouts", "description": "Page layouts — sections + columns + field placement per module + profile, with clone helper."},
        {"name": "profiles", "description": "Permission profiles — per-module CRUD + export + share flags, field-level access matrix (hidden / visible / read_only / editable), clone helper."},
        {"name": "territories", "description": "Territory management — territories + members + realign service (round_robin / load_balance / all_to_manager)."},
        {"name": "canvas", "description": "Per-tenant white-label canvas theme (singleton) — colors, font, density, sidebar, logo, custom CSS; 5 pre-built templates; preview action."},
        {"name": "sandbox", "description": "Configuration sandboxes — capture tenant customisation snapshot, branch, compare, push to production."},
        {"name": "template_builder", "description": "Email + PDF template builder — name / subject / body_html / html_template / css / category; preview + render (Django template engine)."},
        {"name": "ai_core", "description": "Central AI orchestrator — AICostLog (per-call token + cost ledger) + PromptTemplate (versioned system + user-prompt-template pairs); call_llm / stream_llm / check_budget."},
        {"name": "lead_scoring", "description": "Predictive lead scoring — 0-100 heuristic from CRM-recorded fields (email / phone / company / annual_revenue / source); hot-lead threshold 80; Celery beat daily 2am re-score."},
        {"name": "deal_prediction", "description": "Predicted deal value + close probability (expected_value = amount * stage.probability); week-over-week probability-drop detection (>20% = at-risk); Celery beat daily 2:30am re-predict."},
        {"name": "anomaly_detection", "description": "CRM anomaly scanning — deal-amount drops, rep-activity drops, lead-response-time breaches; severity low/medium/high/critical; status open/acknowledged/resolved; Celery beat hourly scan; high/critical fire notifications."},
        {"name": "sentiment_analysis", "description": "Text-sentiment scoring — heuristic positive/negative word lexicons; sentiment in [-1,+1] + confidence in [0,1]; per-record trend + heatmap aggregates."},
        {"name": "smart_suggestions", "description": "Next-best-action suggestion cards per user — leads-not-contacted-in-7d, deals-stuck-in-stage, accounts-no-activity-60d; accept / dismiss lifecycle."},
        {"name": "nlp_queries", "description": "Natural-language CRM queries — keyword-matching NL→spec parser (deals closing this month / open leads / won deals); execute against ORM; promote to reports."},
        {"name": "zia_chatbot", "description": "Zia conversational assistant — per-user conversation thread with CRM-aware system prompt + function-calling tool surface (search_records / create_task / score_lead / predict_deal / generate_suggestions)."},
        {"name": "ai_writer", "description": "AI content drafts — generate_email (style + tone), generate_summary (3-5 bullets), generate_subject_lines (3-5 candidates); draft_type email/blog/social/summary/proposal."},
        {"name": "ai_agents", "description": "Autonomous AI agent runs — 5 agent types (lead_research / deal_coach / email_triage / data_hygiene / customer_success); status running/completed/failed; Celery tasks triggered by CRM signals; 5min sweep beat."},
    ],
}

###############################################################################
# SimpleJWT — 15min access / 30d refresh
###############################################################################

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "TOKEN_TYPE_CLAIM": "token_type",
    "ALGORITHM": "HS256",
    "SIGNING_KEY": os.environ.get("JWT_SIGNING_KEY", SECRET_KEY),
}

###############################################################################
# django-allauth
###############################################################################

ACCOUNT_AUTHENTICATION_METHOD = "email"
ACCOUNT_EMAIL_REQUIRED = True
ACCOUNT_EMAIL_VERIFICATION = "mandatory"
ACCOUNT_LOGIN_ATTEMPTS_LIMIT = 5
ACCOUNT_LOGIN_ATTEMPTS_TIMEOUT = 3600  # seconds
ACCOUNT_LOGOUT_ON_PASSWORD_CHANGE = False
ACCOUNT_SESSION_REMEMBER = True
ACCOUNT_UNIQUE_EMAIL = True
ACCOUNT_USER_MODEL_USERNAME_FIELD = None
ACCOUNT_USERNAME_REQUIRED = False
ACCOUNT_EMAIL_CONFIRMATION_EXPIRE_DAYS = 3
SOCIALACCOUNT_QUERY_EMAIL = True
SOCIALACCOUNT_EMAIL_VERIFICATION = "none"
SOCIALACCOUNT_AUTO_SIGNUP = True
SOCIALACCOUNT_STORE_TOKENS = True
SOCIALACCOUNT_ADAPTER = "allauth.account.adapter.DefaultSocialAccountAdapter"

# Per-provider credentials — read from env. Set them in your `.env` file.
SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "APP": {
            "client_id": os.environ.get("GOOGLE_OAUTH_CLIENT_ID", ""),
            "secret": os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", ""),
            "key": "",
        },
        "SCOPE": ["profile", "email", "openid"],
        "AUTH_PARAMS": {"access_type": "online"},
    },
    "microsoft": {
        "APP": {
            "client_id": os.environ.get("MICROSOFT_OAUTH_CLIENT_ID", ""),
            "secret": os.environ.get("MICROSOFT_OAUTH_CLIENT_SECRET", ""),
            "key": "",
        },
        "SCOPE": ["User.Read", "openid", "email", "profile"],
    },
    "apple": {
        "APP": {
            "client_id": os.environ.get("APPLE_OAUTH_CLIENT_ID", ""),
            "secret": os.environ.get("APPLE_OAUTH_CLIENT_SECRET", ""),
            "key": os.environ.get("APPLE_OAUTH_KEY_ID", ""),
        },
        "SCOPE": ["email", "name"],
    },
    "github": {
        "APP": {
            "client_id": os.environ.get("GITHUB_OAUTH_CLIENT_ID", ""),
            "secret": os.environ.get("GITHUB_OAUTH_CLIENT_SECRET", ""),
            "key": "",
        },
        "SCOPE": ["read:user", "user:email"],
    },
    "linkedin": {
        "APP": {
            "client_id": os.environ.get("LINKEDIN_OAUTH_CLIENT_ID", ""),
            "secret": os.environ.get("LINKEDIN_OAUTH_CLIENT_SECRET", ""),
            "key": "",
        },
        "SCOPE": ["r_liteprofile", "r_emailaddress"],
    },
}

###############################################################################
# django-axes — throttle after 5 failures, 1hr lockout
###############################################################################

AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = timedelta(hours=1)
AXES_LOCKOUT_PARAMETERS = [["username", "ip_address"]]
AXES_RESET_ON_SUCCESS = True
AXES_RESET_COOL_OFF_ON_FAILURE_DURING_LOCKOUT = True
AXES_CACHE = "default"
AXES_LOGGER = "axes.watch_login"
AXES_LOCKOUT_TEMPLATE = None
AXES_LOCKOUT_CALLABLE = None
AXES_ONLY_USER_FAILURES = False
AXES_DISABLE_ACCESS_LOG = False
AXES_LOCK_OUT_BY_COMBINATION_USER_AND_IP = True
AXES_USE_PROXY = True  # respect X-Forwarded-For

###############################################################################
# django-guardian — object-level perms
###############################################################################

ANONYMOUS_USER_NAME = "AnonymousUser"
GUARDIAN_RAISE_403 = True

###############################################################################
# SAML2 (djangosaml2) configuration skeleton
###############################################################################

# SAML2_CONFIG can be a dict (single-tenant) or a callable ``config(request)``
# that returns a pysaml2 config dict. See api/saml_views.get_saml_config.
SAML2_CONFIG = None  # set to a dict or callable when SAML is enabled
SAML2_DEFAULT_IDP = ""
SAML2_FRONTEND_REDIRECT_URL = os.environ.get("SAML2_FRONTEND_REDIRECT_URL", "")
SAML2_ATTR_MAP = {
    "email": ("urn:oid:0.9.2342.19200300.100.1.3", "email", "Email"),
    "name": ("urn:oid:2.5.4.3", "cn", "displayName"),
}
# Optional callable: SAML2_TENANT_RESOLVER(request, attrs) -> Organization | None
SAML2_TENANT_RESOLVER = None

# Static SP config (single-tenant deployments). Multi-tenant deployments
# override SAML2_CONFIG with a callable.
_SAML2_STATIC_BASE = {
    "entityid": os.environ.get("SAML2_ENTITY_ID", "https://foundation.local/saml/metadata/"),
    "description": "Foundation SP",
    "service": {
        "sp": {
            "name": "Foundation SP",
            "endpoints": {
                "assertion_consumer_service": [
                    "http://localhost:8000/saml/acs/",
                ],
                "single_logout_service": [
                    "http://localhost:8000/saml/sls/",
                ],
            },
            "allow_unsolicited": True,
            "authn_requests_signed": False,
            "logout_requests_signed": False,
            "want_assertions_signed": True,
            "want_response_signed": False,
        }
    },
    "metadata": {
        "remote": [
            {"url": os.environ.get("SAML2_IDP_METADATA_URL", ""), "disable_certificate_validation": False},
        ],
    },
    "key_file": os.environ.get("SAML2_KEY_FILE", ""),
    "cert_file": os.environ.get("SAML2_CERT_FILE", ""),
    "xmlsec_binary": os.environ.get("SAML2_XMLSEC_BINARY", "/usr/bin/xmlsec1"),
    "organization": {
        "name": "Foundation",
        "display_name": "Foundation",
        "url": "http://localhost:3000",
    },
    "contact_person": [
        {
            "given_name": "Admin",
            "sur_name": "Admin",
            "company": "Foundation",
            "email_address": "admin@foundation.local",
            "contact_type": "technical",
        }
    ],
}
if os.environ.get("SAML2_ENABLED", "false").lower() == "true":
    SAML2_CONFIG = _SAML2_STATIC_BASE

###############################################################################
# SCIM 2.0 settings
###############################################################################

SCIM_CONTENT_TYPE = "application/scim+json"
# The bearer tokens used to authenticate SCIM requests are stored per-org on
# Organization.scim_endpoint_token (admin sets them via the IP allowlist UI).
SCIM_USER_FILTER_SUPPORTED = False  # set True when filter parsing is wired

###############################################################################
# Password policy & validation
###############################################################################

PASSWORD_MIN_LENGTH = 12
PASSWORD_HISTORY_LIMIT = 10
PASSWORD_EXPIRY_DAYS = 90
PASSWORD_BREACH_CHECK_STRICT = os.environ.get("PASSWORD_BREACH_CHECK_STRICT", "false").lower() == "true"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "api.validators.PasswordComplexityValidator"},
    {"NAME": "api.validators.PasswordHistoryValidator"},
    {"NAME": "api.validators.PasswordExpiryValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Login throttling / suspicious-login alert thresholds.
LOGIN_SUSPICIOUS_NEW_GEO = True
LOGIN_SUSPICIOUS_NEW_DEVICE = True

# Audit log retention (days).
AUDIT_LOG_RETENTION_DAYS = 365

# Celery beat schedule (auth-related recurring tasks).
CELERY_BEAT_SCHEDULE = {
    "cleanup-expired-sessions": {
        "task": "api.cleanup_expired_sessions",
        "schedule": timedelta(hours=1),
    },
    "rotate-api-keys": {
        "task": "api.rotate_api_keys",
        "schedule": timedelta(hours=6),
    },
    "custom-fields-recompute-formulas": {
        "task": "custom_fields.recompute_formulas",
        "schedule": timedelta(hours=1),
        # The task sweeps all tenants/modules at runtime — no kwargs needed
        # (django-celery-beat's static schedule doesn't support per-tenant
        # dispatch).
    },
    "crm-ux-cleanup-trash": {
        "task": "crm_ux.cleanup_trash",
        # Daily at 02:00 UTC — permanently purge CRM records soft-deleted
        # more than 30 days ago (configurable via task kwargs).
        "schedule": crontab(hour=2, minute=0),
    },
    # ----------------------------------------------------------------- Phase 5 productivity
    # Tasks app — reminders, digest, recurring-task expansion.
    "tasks-send-reminders": {
        "task": "tasks.send_task_reminders",
        "schedule": timedelta(minutes=15),
    },
    "tasks-daily-digest": {
        "task": "tasks.send_daily_digest",
        # Daily at 08:00 UTC — email each user their due-today + overdue tasks.
        "schedule": crontab(hour=8, minute=0),
    },
    "tasks-generate-recurring": {
        "task": "tasks.generate_recurring_tasks",
        # Daily at 03:00 UTC — advance recurring tasks whose due_date has passed.
        "schedule": crontab(hour=3, minute=0),
    },
    # Events app — reminders + recurring-event expansion.
    "events-send-reminders": {
        "task": "events.send_event_reminders",
        "schedule": timedelta(minutes=5),
    },
    "events-generate-recurring": {
        "task": "events.generate_recurring_events",
        # Daily at 03:30 UTC — advance recurring events whose start has passed.
        "schedule": crontab(hour=3, minute=30),
    },
    # ----------------------------------------------------------------- Phase 6 content
    # Files app — daily cleanup of soft-deleted files (archive >90d, hard-delete >7y).
    "files-cleanup-old-files": {
        "task": "files.cleanup_old_files",
        # Daily at 03:00 UTC — but offset by 30 minutes so it doesn't collide
        # with the events-generate-recurring task on the same worker.
        "schedule": crontab(hour=3, minute=45),
    },
    # ----------------------------------------------------------------- Phase 7 real-time
    # Notifications app — daily digest email (per user with digest_mode=daily).
    "notifications-daily-digest": {
        "task": "notifications.send_daily_digest",
        # Daily at 09:00 UTC — sent after the morning task-digest so users
        # who have both configured don't get two emails at 08:00.
        "schedule": crontab(hour=9, minute=0),
    },
    # ----------------------------------------------------------------- Phase 8 pipeline engine
    # Deals app — daily pipeline-health sweeps. Stuck deals (in a stage past
    # its ``business_days_limit``) and overdue deals (``close_date`` passed
    # while still open) both fire notifications to the owner + tenant admins.
    "deals-check-stuck-deals": {
        "task": "deals.check_stuck_deals",
        "schedule": crontab(hour=9, minute=0),
    },
    "deals-check-overdue-deals": {
        "task": "deals.check_overdue_deals",
        "schedule": crontab(hour=9, minute=5),
    },
    # ----------------------------------------------------------------- Phase 9 blueprint
    # Blueprint app — hourly timer sweep. Fires every BlueprintTimer whose
    # ``hours`` have elapsed since the deal entered its current state.
    "blueprint-check-timers": {
        "task": "blueprint.run_blueprint_timers",
        "schedule": timedelta(hours=1),
    },
    # ----------------------------------------------------------------- Phase 10 rule engine
    # Approvals app — hourly escalation sweep. Walks every pending
    # ApprovalRequest whose current_step.time_limit_hours has elapsed and
    # re-routes it to the step's escalation_approver.
    "approvals-escalate-expired": {
        "task": "approvals.escalate_expired",
        "schedule": timedelta(hours=1),
    },
    # Escalation-rules app — 15-minute SLA sweep. Walks every active
    # EscalationRule and escalates records past their time_limit_hours.
    "escalation-check": {
        "task": "escalation_rules.run_escalation_check",
        "schedule": timedelta(minutes=15),
    },
    # ----------------------------------------------------------------- Phase 11 workflows
    # Scheduled-actions app — 1-minute cron sweep. Walks every active
    # ScheduledJob whose next_run_at <= now, dispatches it, and recomputes
    # next_run_at from the cron expression.
    "scheduled-actions-check": {
        "task": "scheduled_actions.run_scheduled_jobs",
        "schedule": timedelta(minutes=1),
    },
    # ----------------------------------------------------------------- Phase 13 email + telephony
    # Email-integration app — 2-minute IMAP sync sweep, 1-minute
    # schedule-send sweep, daily follow-up-reminder digest.
    "email-sync-all": {
        "task": "email_integration.sync_all_accounts",
        "schedule": timedelta(minutes=2),
    },
    "email-send-scheduled": {
        "task": "email_integration.send_scheduled_emails",
        "schedule": timedelta(minutes=1),
    },
    "email-follow-up-reminders": {
        "task": "email_integration.check_follow_up_reminders",
        # Daily at 09:30 UTC — after the notifications + tasks digests.
        "schedule": crontab(hour=9, minute=30),
    },
    # Telephony app — daily recording-URL cleanup (preserve audit row,
    # wipe the S3 link so the bucket can be lifecycle-policy'd).
    "telephony-cleanup-recordings": {
        "task": "telephony.cleanup_old_recordings",
        "schedule": crontab(hour=4, minute=0),
    },
    # ----------------------------------------------------------------- Phase 14 omnichannel
    # Social app — 5-minute mention-sync sweep across every active
    # SocialAccount (Twitter / LinkedIn / Facebook / Instagram).
    "social-sync-mentions": {
        "task": "social.sync_all_mentions",
        "schedule": timedelta(minutes=5),
    },
    # Social app — 1-minute scheduled-post publish sweep. Dispatches every
    # ScheduledPost whose scheduled_at has elapsed via the provider API.
    "social-publish-scheduled": {
        "task": "social.publish_scheduled_posts",
        "schedule": timedelta(minutes=1),
    },
    # Unified inbox — 5-minute SLA-breach sweep. Counts open conversations
    # whose sla_response_deadline / sla_resolution_deadline has elapsed.
    "inbox-check-sla": {
        "task": "inbox.check_sla_breaches_task",
        "schedule": timedelta(minutes=5),
    },
    # ----------------------------------------------------------------- Phase 15 reports
    # Reports app — 1-minute cron-driven scheduled-report sweep. Walks every
    # published Report whose ``schedule_cron`` matches the current minute and
    # dispatches it via ``reports.run_scheduled_report`` (executes + e-mails
    # subscribers).
    "reports-run-scheduled": {
        "task": "reports.run_scheduled_reports",
        "schedule": timedelta(minutes=1),
    },
    # ----------------------------------------------------------------- Phase 16 goals
    # Goals app — daily 1am actual-amount refresh across every active
    # Goal. Recalculates revenue / deals_closed / calls_made / etc. for
    # the current period and writes the new value to ``actual_amount``.
    "goals-refresh-all": {
        "task": "goals.refresh_all_goals",
        "schedule": crontab(hour=1, minute=0),
    },
    # ----------------------------------------------------------------- Phase 18 AI layer
    # Anomaly-detection app — hourly scan for CRM anomalies (deal-amount
    # drops, rep-activity drops, lead-response-time breaches, unusual
    # patterns). High / critical severities fire notifications via the
    # notifications app.
    "anomaly-scan": {
        "task": "anomaly_detection.scan_anomalies",
        "schedule": timedelta(hours=1),
    },
    # Lead-scoring app — daily 2am re-score of every Lead in every
    # tenant. Recomputes the 0-100 heuristic from CRM-recorded fields
    # (email / phone / company / annual_revenue / source).
    "lead-score-all": {
        "task": "lead_scoring.score_all_leads",
        "schedule": crontab(hour=2, minute=0),
    },
    # Deal-prediction app — daily 2:30am re-prediction of every Deal.
    # Recomputes close_probability + expected_value + stashes the prior
    # probability so the get_at_risk service can detect >20% week-over-
    # week drops.
    "deal-predict-all": {
        "task": "deal_prediction.predict_all_deals",
        "schedule": crontab(hour=2, minute=30),
    },
    # AI-agents app — 5-minute sweep that re-dispatches data-hygiene +
    # customer-success agent runs across every tenant. Per-lead /
    # per-deal / per-email agent runs are dispatched on-demand by CRM
    # signals (not via beat).
    "ai-agents-run": {
        "task": "ai_agents.run_pending_sweep",
        "schedule": timedelta(minutes=5),
    },
    # ----------------------------------------------------------------- Phase 20 security
    # Backup app — daily 02:00 UTC full backup. Dispatches a tenant sweep
    # that creates a BackupRecord(type=full, status=pending) row for every
    # tenant (the real task would also kick off the actual DB / S3
    # snapshot + mark status=completed on success).
    "backup-daily-full": {
        "task": "backup.run_daily_full",
        "schedule": crontab(hour=2, minute=0),
    },
    # Data-security app — daily 03:00 UTC retention sweep. Walks every
    # RetentionPolicy and applies the configured action (archive / delete)
    # to records whose age exceeds ``retention_days``.
    "retention-cleanup": {
        "task": "data_security.run_retention_cleanup",
        "schedule": crontab(hour=3, minute=0),
    },
}

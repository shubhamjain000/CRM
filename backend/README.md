# Foundation Backend — Phase 17 (Platform customization)

Django + DRF + Celery + Channels (Daphne). Brought up by `make dev` from the
repo root (runs via Docker Compose).

## What's in Phase 10

Phase 10 builds the **rule engine** — four tenant-scoped automation apps
that sit on top of the Phase 3 CRM models + the Phase 8 pipeline + Phase 9
blueprint engine:

- **`approvals/`** — multi-step approval workflow engine. The Phase-8
  `ApprovalProcess` stub (in `deals/models.py`) is **promoted** to the
  canonical `approvals.ApprovalProcess` model with the new
  `target_model` / `trigger_criteria` / `version` fields. The runtime
  models `ApprovalStep` / `ApprovalRequest` / `ApprovalAction` /
  `ApprovalDelegation` plus the `ApprovalService` service layer ship in
  this app. `StageTransition.require_approval` and
  `BlueprintTransition.require_approval` FKs now point at
  `approvals.ApprovalProcess`.
- **`validation_rules/`** — tenant-scoped field validators
  (`required` / `regex` / `range` / `unique` / `custom`) fired on
  `pre_save` of Lead / Contact / Account / Deal. Error-severity rules
  raise `ValidationError` and block the save; warning-severity rules
  are logged only.
- **`assignment_rules/`** — auto-assign records to users via
  `round_robin` / `lead_balance` / `territory` / `custom` strategies.
  A `post_save(created=True)` signal on Lead / Contact / Account / Deal
  enqueues a Celery task that evaluates the rule set and updates the
  record's `owner`.
- **`escalation_rules/`** — auto-escalate records that breach an SLA.
  A 15-minute Celery beat task walks every active `EscalationRule`,
  finds records matching `criteria` whose `created_at` exceeds
  `time_limit_hours`, and takes the configured `action`
  (`reassign` / `notify` / `both`).

The four apps are wired into `INSTALLED_APPS` after `blueprint` (so the
`approvals.ApprovalProcess` FK target is resolvable at app-load time) and
exposed under `/api/v1/approval-processes/`,
`/api/v1/approval-requests/`, `/api/v1/approval-delegations/`,
`/api/v1/validation-rules/`, `/api/v1/assignment-rules/`,
`/api/v1/assignment-histories/`, `/api/v1/escalation-rules/`, and
`/api/v1/escalation-logs/`.

### `approvals/` — multi-step approval workflow

The `ApprovalProcess` model is the canonical definition (tenant FK,
`name`, `target_model`, `trigger_criteria` JSON, `is_active`,
`version`, `description`). An `ApprovalProcess` has an ordered list of
`ApprovalStep` rows; each step carries a `step_type`
(`sequential` / `parallel` / `first_to_approve` / `majority_vote` /
`unanimous`), an `approvers` JSON list of `{type, value}` dicts (where
`type` ∈ `role` / `user` / `team` / `dynamic`), an optional
`time_limit_hours`, and an optional `escalation_approver`.

The `ApprovalService` is the canonical interface:

| Method | Description |
|--------|-------------|
| `submit(record_module, record_id, record_name, process_name, submitted_by, record_data=None)` | Create + dispatch a new `ApprovalRequest`. Validates the record against `trigger_criteria`, advances to the first step, and notifies the first step's approvers. |
| `approve(request, user, comment="")` | Record an `ApprovalAction`, advance / complete the step per `step_type`, notify the submitter on completion. |
| `reject(request, user, comment="")` | Flip status to `rejected`, set `completed_at`, notify the submitter. |
| `delegate(request, user, delegate_to, comment="")` | Re-route the current step to `delegate_to`; records an `ApprovalAction` for audit. |
| `recall(request, user)` | Submitter cancels a pending request. Status flips to `recalled`. |
| `escalate_expired()` | Celery beat (hourly). Walk every pending request whose `current_step.time_limit_hours` has elapsed and escalate to the step's `escalation_approver`. |
| `get_pending_for_user(user)` | Requests where `user` is an approver in the current step + `status=pending`. Honors active `ApprovalDelegation`. |
| `get_my_requests(user)` | Requests submitted by `user`. |

`ApprovalDelegation` is a date-ranged "out of office" rule: while
`is_active=True` and today falls inside `[start_date, end_date]`,
`get_pending_for_user(delegate_to)` also returns requests delegated
*from* the original user.

The HTTP surface:

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/approval-processes/` | List (cursor-paginated, filter by `target_model` / `is_active`) |
| POST   | `/api/v1/approval-processes/` | Create (requires `approvals.manage`) |
| GET    | `/api/v1/approval-processes/{id}/` | Retrieve (with nested steps) |
| PATCH  | `/api/v1/approval-processes/{id}/` | Update |
| DELETE | `/api/v1/approval-processes/{id}/` | Destroy |
| GET    | `/api/v1/approval-processes/{id}/steps/` | List ordered steps |
| POST   | `/api/v1/approval-processes/{id}/steps/` | Create a new step |
| GET    | `/api/v1/approval-requests/` | List (filter by `status` / `submitted_by` / `target_module` / `target_id`) |
| POST   | `/api/v1/approval-requests/` | Create — dispatches via `ApprovalService.submit` |
| POST   | `/api/v1/approval-requests/{id}/approve/` | `{"comment": "..."}` |
| POST   | `/api/v1/approval-requests/{id}/reject/` | `{"comment": "..."}` |
| POST   | `/api/v1/approval-requests/{id}/delegate/` | `{"delegate_to": <user_id>, "comment": "..."}` |
| POST   | `/api/v1/approval-requests/{id}/recall/` | (no body) — submitter only |
| POST   | `/api/v1/approval-requests/bulk-approve/` | `{"ids": [...], "comment": "..."}` |
| GET    | `/api/v1/approval-requests/pending/` | Requests awaiting the current user's action |
| GET    | `/api/v1/approval-requests/my-requests/` | Requests submitted by the current user |
| GET    | `/api/v1/approval-requests/{id}/actions/` | Append-only audit log |
| GET    | `/api/v1/approval-delegations/` | List (filter by `user` / `is_active`) |
| POST   | `/api/v1/approval-delegations/` | Create (auto-stamps `user` = current user) |
| PATCH  | `/api/v1/approval-delegations/{id}/` | Update |

### `validation_rules/` — runtime field validators

A `ValidationRule` is a tenant-scoped, per-field, per-condition rule
that fires on `create` / `update` / `both`. The `condition_type` drives
the evaluation:

- `required` — the field must be non-empty.
- `regex` — the field's string value must match `condition_value.regex`.
- `range` — the field's numeric value must be within
  `[condition_value.min, condition_value.max]` (inclusive).
- `unique` — the field's value must be unique within the tenant for the
  target model.
- `custom` — the field's value must satisfy `condition_value.expression`
  (a Python expression evaluated with the record's fields as locals).

`error_severity` is one of `error` (raises `ValidationError` and blocks
the save) or `warning` (logged but does not block). The `pre_save`
signal in `validation_rules/signals.py` enforces the rule set on every
Lead / Contact / Account / Deal save.

The `ValidationService` is the canonical interface:

| Method | Description |
|--------|-------------|
| `evaluate_rule(rule, record_data)` | Evaluate a single rule. Returns `{valid, message}`. |
| `validate_record(model, record_data, trigger='both', record_id=None, instance=None)` | Run every active rule for `model`. Returns a list of `ValidationViolation` named tuples. |
| `bulk_check(model)` | Iterate every existing record of `model` and run `validate_record`. Returns a flat list of violations across the tenant. |
| `enforce(model, record_data, trigger)` | Run `validate_record` and raise `ValidationError` on error-severity failures. Used by the `pre_save` signal. |

The HTTP surface:

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/validation-rules/` | List (filter by `target_model` / `field_name` / `is_active`) |
| POST   | `/api/v1/validation-rules/` | Create (requires `validation_rules.manage`) |
| PATCH  | `/api/v1/validation-rules/{id}/` | Update |
| DELETE | `/api/v1/validation-rules/{id}/` | Destroy |
| POST   | `/api/v1/validation-rules/test/` | `{"target_model": "deal", "record": {...}, "trigger": "create"}` → `{"violations": [...]}` |
| GET    | `/api/v1/validation-rules/bulk-check/?target_model=deal` | Violations across every existing record |

### `assignment_rules/` — auto-assign records to users

An `AssignmentRule` is a tenant-scoped, per-target-model rule with a
`criteria` JSON dict (exact-match semantics), a `strategy`
(`round_robin` / `lead_balance` / `territory` / `custom`), an
`assign_to` JSON list whose shape depends on the strategy, an optional
`fallback_user` FK, and an optional `territory_field` (required when
`strategy=territory`).

The `AssignmentService` is the canonical interface:

| Method | Description |
|--------|-------------|
| `evaluate_rules(record_module, record_data)` | Find the first matching active rule and execute its strategy. Returns `(rule, user)`. |
| `execute_strategy(rule, record_data)` | Run a single rule's strategy. Returns the resolved user (or `None`). |
| `assign(record_module, record_id, record_data)` | Wrap `evaluate_rules`, update the record's `owner`, log an `AssignmentHistory` row. |

Strategies:

- `round_robin` — track the last assignment via `AssignmentHistory`
  and pick the next user in `assign_to`.
- `lead_balance` — count open records per user in `assign_to` and pick
  the fewest.
- `territory` — look up `record[territory_field]` in
  `assign_to.user_map`.
- `custom` — evaluate `assign_to.expression` with the record's fields
  as locals and expect a user id back.

The `post_save(created=True)` signal in `assignment_rules/signals.py`
enqueues the Celery task `assignment_rules.evaluate_assignment_rules`
which calls `AssignmentService.assign` on every Lead / Contact /
Account / Deal create.

The HTTP surface:

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/assignment-rules/` | List (filter by `target_model` / `strategy` / `is_active`) |
| POST   | `/api/v1/assignment-rules/` | Create (requires `assignment_rules.manage`) |
| PATCH  | `/api/v1/assignment-rules/{id}/` | Update |
| DELETE | `/api/v1/assignment-rules/{id}/` | Destroy |
| POST   | `/api/v1/assignment-rules/evaluate/` | `{"target_model": "lead", "record": {...}}` → `{"rule_id": ..., "user_id": ...}` |
| GET    | `/api/v1/assignment-histories/` | List (filter by `record_module` / `record_id` / `assigned_to`) |
| GET    | `/api/v1/assignment-histories/{id}/` | Retrieve |

### `escalation_rules/` — auto-escalate records that breach an SLA

An `EscalationRule` is a tenant-scoped, per-target-model rule with a
`criteria` JSON dict, a `time_limit_hours` integer, an `escalate_to`
JSON `{type, value}` dict (where `type` ∈ `user` / `role` / `team`),
and an `action` (`reassign` / `notify` / `both`).

The `EscalationService` is the canonical interface:

| Method | Description |
|--------|-------------|
| `evaluate_criteria(record_data, criteria)` | Return `True` when `record_data` matches every `criteria` clause (exact-match). |
| `check_escalations()` | Celery beat (every 15 min). Walk every active rule, find records matching `criteria` whose `created_at` exceeds `time_limit_hours`, take the configured `action`, and log an `EscalationLog` row. |

The Celery beat task `escalation_rules.run_escalation_check` (every 15
min) wraps `check_escalations` in a per-tenant `tenant_context` loop so
RLS / audit logs are scoped correctly.

The HTTP surface:

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/escalation-rules/` | List (filter by `target_model` / `action` / `is_active`) |
| POST   | `/api/v1/escalation-rules/` | Create (requires `escalation_rules.manage`) |
| PATCH  | `/api/v1/escalation-rules/{id}/` | Update |
| DELETE | `/api/v1/escalation-rules/{id}/` | Destroy |
| GET    | `/api/v1/escalation-rules/{id}/dry-run/` | List the records this rule would escalate without escalating them |
| GET    | `/api/v1/escalation-logs/` | List (filter by `record_module` / `record_id` / `escalated_to` / `action_taken`) |
| GET    | `/api/v1/escalation-logs/{id}/` | Retrieve |

### Celery beat schedule (Phase 10 additions)

| Name | Task | Schedule |
|------|------|----------|
| `approvals-escalate-expired` | `approvals.escalate_expired` | hourly |
| `escalation-check` | `escalation_rules.run_escalation_check` | every 15 min |

## What's in Phase 9

Phase 9 builds the **blueprint engine** (Zoho Blueprint equivalent) on top
of the Phase-8 pipeline graph. A blueprint binds to a
`Pipeline` and adds:

- **`Blueprint`** — the published state-machine overlay. Only one active
  blueprint per pipeline (enforced by a partial unique constraint on
  `(tenant, pipeline)` filtered by `is_active=True`). `publish` bumps
  `version` and deactivates any prior active blueprint on the same
  pipeline; `archive` flips `is_active=False` but keeps the row for
  history.
- **`BlueprintState`** — one row per pipeline `Stage` with typed state
  metadata (`normal` / `transitional` / `terminal`), entry / exit action
  lists (JSON), an optional `time_limit_hours` (drives the stuck-deal
  alert), and an optional `escalation_blueprint` FK (a deal that exceeds
  the limit may be moved into another blueprint's flow).
- **`BlueprintTransition`** — the directed edge between two states.
  Carries an `allowed_roles` allow-list (empty = all roles), a JSON
  `conditions` blob evaluated against the deal (e.g.
  `{"amount": {"$gt": 50000}}`), a `require_fields` list of must-be-filled
  field names, an optional `require_approval` FK to the Phase-8
  `ApprovalProcess` stub, and a `post_transition_actions` JSON list.
- **`BlueprintFieldRequirement`** — structured per-field conditions on a
  transition (`not_empty` / `equals` / `not_equals` / `greater_than` /
  `less_than` / `in`). The richer sibling of `require_fields`.
- **`BlueprintAssignment`** — per-transition assignment rule
  (`role` / `user` / `team` / `field_value`).
- **`BlueprintTimer`** — per-state timer that auto-transitions, notifies,
  or escalates when a deal overstays the state. The hourly Celery beat
  task `blueprint.run_blueprint_timers` fires every due timer.
- **`BlueprintExecution`** — the runtime state machine for a single
  `Deal` (current state, `entered_state_at` timestamp, `history` JSON
  list of `{from_state, to_state, changed_by, changed_at, reason}`
  entries, completion flag). Exactly one execution per deal
  (`unique_together=(("deal",),)`).

The `BlueprintService` is the canonical interface:

| Method | Description |
|--------|-------------|
| `validate_transition(deal, to_state, user)` | Validate a move without executing it. Returns `{valid, errors, missing_fields, requires_approval}`. |
| `execute_transition(deal, to_state, user, reason="")` | Atomic transition — validates, runs exit/entry/post-transition actions, updates the deal's stage + forecast_category, logs `DealStageHistory`, dispatches approval-request notification when gated. |
| `get_available_transitions(deal, user)` | List every reachable target state from the deal's current state, with per-target block reasons. |
| `enforce_on_create(deal)` | Auto-create a `BlueprintExecution` when a deal lands in a pipeline with an active blueprint. Called by the `Deal.post_save` signal. |
| `check_timers()` | Hourly Celery beat. Fires every due `BlueprintTimer` (auto-transition / notify / escalate). |
| `get_compliance_report(pipeline)` | `{total_deals, in_blueprint, compliant_deals, non_compliant_deals, compliance_rate, stuck_deals}`. |
| `get_stuck_deals(pipeline)` | Deals whose current state has exceeded `time_limit_hours`. |
| `evaluate_condition(deal, conditions)` | JSON field-expression evaluator — supports `$gt` / `$lt` / `$gte` / `$lte` / `$eq` / `$ne` / `$in` / `$exists`. |
| `run_actions(actions, deal, context)` | Execute a list of `{type, params}` action dicts (`create_task`, `send_notification`, `update_field`, `assign_to`). |

The HTTP surface mounts under `/api/v1/blueprints/`,
`/api/v1/blueprint-states/`, `/api/v1/blueprint-transitions/`, and
`/api/v1/blueprint-executions/`. The execution viewset exposes the
runtime actions `available-transitions`, `execute-transition`,
`compliance-report`, and `stuck-deals`.

## What's in Phase 8

Phase 8 builds the **sales pipeline engine** on top of the Phase 3 deals
app:

- **Stage transitions** — directed graph of allowed stage moves with
  role-based allow-lists + JSON condition rules. Arbitrary drag-and-drop
  is rejected; the API only honours moves that have a
  `StageTransition` row.
- **Deal stage history** — append-only `DealStageHistory` audit trail.
  Each row records the from-stage, the to-stage, the actor, an optional
  reason, and the seconds the deal spent in the prior stage (used for
  velocity + conversion analytics).
- **`PipelineService`** — the canonical service-layer interface for
  transitioning a deal, computing per-stage metrics, deal velocity,
  conversion rates, win-rate-by-stage, monthly trends, and at-risk
  detection.
- **Forecast categories** — every stage carries a `forecast_category`
  (`pipeline` / `best_case` / `commit` / `closed` / `omitted`). Deals
  inherit the category from their current stage on every transition, so
  the forecast view is always consistent with the pipeline snapshot.
- **Stage limits + alerts** — `Stage.business_days_limit` drives a
  daily Celery sweep that flags deals stuck in a stage past the limit.
  A second sweep flags overdue deals (`close_date` passed while still
  open). A `post_save` signal on `Deal` notifies tenant admins when a
  deal's amount drops by more than 50 % in a single save.

The HTTP surface is unchanged (still under `/api/v1/deals/`, plus the
new `/api/v1/stage-transitions/`). Existing `/deals/{id}/change-stage/`
remains for backward compatibility; the new
`/deals/{id}/transition/` is the canonical, transition-graph-validated
path.

## What's in Phase 7

Phase 7 builds the **real-time fabric** on top of the Phase 3/4/5/6 modules:

- **`feed/`** — Chatter-like tenant activity feed (posts, comments,
  emoji reactions) with @mentions + #hashtags auto-parsing.
- **`notifications/`** — in-app / email / push / SMS notification dispatch
  with per-user preferences + quiet hours + daily digest.
- **`realtime/`** — Django Channels WebSocket layer (presence, cursors,
  typing indicators, record-update broadcasts) backed by Redis.

The new WebSocket endpoint is `ws/realtime/` (mounted by `config/asgi.py`).
HTTP endpoints mount under the existing `/api/v1/` namespace.

## What's in Phase 6

Phase 6 builds the **content backend** on top of the Phase 3/4/5 modules:

- **`notes/`** — collaborative rich-text notes (HTML / Yjs / Markdown) with
  @mentions, #hashtags, sharing, inline comments, and version history.
- **`files/`** — S3/MinIO-backed file storage with versioning, virus scan
  (ClamAV), OCR (Tesseract), full-text extraction (Tika), DLP PII detection,
  PDF watermarking, and share links.
- **`attachments/`** — polymorphic join between any CRM record
  (lead/contact/account/deal/task/event/note) and a File, with bulk ZIP
  download.

### Notes (`notes/`)

`Note` model inherits `SoftDeleteTenantModel` (tenant FK + timestamps +
`deleted_at` + soft-delete-aware managers). Fields: `title`, `body` (text —
stores Yjs/doc JSON or HTML or Markdown), `body_type` (html|yjs|markdown,
default html), `is_pinned`, `is_private` (default false), `author` (FK User,
RESTRICT), `last_edited_by` (FK User, SET_NULL, nullable), `related_module`
/ `related_id` (CRM link, nullable), `mentions` (JSONField list of user IDs —
parsed from `@<uid>` tokens by the signal), `hashtags` (JSONField list —
parsed from `#hashtag` tokens), `tags` (JSONField list — author-assigned),
`shared_with` (M2M User through `NoteShare`), `edit_history` (JSONField list
of `{user_id, timestamp, snapshot}` entries, capped at 100), `deleted_at`.
CHECK constraints on `body_type`. Indexes on `(tenant, deleted_at)`,
`(tenant, author, -created_at)`, `(tenant, related_module, related_id)`,
`(tenant, is_pinned)`, `(tenant, is_private)`.

`NoteShare` through model: `note` FK CASCADE, `user` FK RESTRICT,
`permission` (read|edit|admin, default read), `created_at`. Unique on
`(note, user)`. CHECK constraint on `permission`.

`NoteComment` model: `note` FK CASCADE, `user` FK RESTRICT, `selected_text`
(text nullable — for inline comments anchored to a body excerpt), `body`
(text), `resolved` (bool), `created_at`, `updated_at`. Indexes on
`(note, -created_at)`, `(note, resolved)`.

`NoteVersion` model: `note` FK CASCADE, `user` FK SET_NULL nullable,
`body` (text snapshot), `version_number` (int), `created_at`. Unique on
`(note, version_number)`. Index on `(note, version_number)`. Created by
the `post_save` signal on every content update (skipped for soft-delete /
restore saves).

Viewset actions:

| Method | Path                                                  | Description                                          |
|--------|-------------------------------------------------------|------------------------------------------------------|
| GET    | `/api/v1/notes/`                                      | List (cursor-paginated, filterable, sortable)        |
| POST   | `/api/v1/notes/`                                      | Create (auto-stamps author; signal parses mentions)  |
| GET    | `/api/v1/notes/{id}/`                                 | Retrieve                                              |
| PATCH  | `/api/v1/notes/{id}/`                                 | Partial update (auto-stamps `last_edited_by`)         |
| DELETE | `/api/v1/notes/{id}/`                                 | Soft-delete (author or admin share only)             |
| POST   | `/api/v1/notes/{id}/pin/`                             | Toggle `is_pinned`                                    |
| POST   | `/api/v1/notes/{id}/share/`                           | Grant `read`/`edit`/`admin` share to a user           |
| DELETE | `/api/v1/notes/{id}/share/`                           | Revoke a share (`{"user_id": <id>}`)                  |
| POST   | `/api/v1/notes/{id}/comment/`                         | Add a comment (optionally anchored to `selected_text`)|
| POST   | `/api/v1/notes/{id}/comments/{cid}/resolve/`         | Toggle the `resolved` flag on a comment               |
| GET    | `/api/v1/notes/{id}/version-history/`                 | All `NoteVersion` snapshots, newest first             |
| POST   | `/api/v1/notes/{id}/restore-version/`                 | Restore body to a previous version (`{"version_number": N}`) |
| POST   | `/api/v1/notes/{id}/save-snapshot/`                   | Explicit checkpoint (creates a new `NoteVersion`)     |

Filters: `author`, `author_in`, `related_module`, `related_id`, `is_pinned`,
`is_private`, `body_type`, `tag` (case-insensitive exact), `hashtag`
(case-insensitive exact, with or without leading `#`), `mention` (user ID
in mentions JSON list), `shared_with` (user ID via the through model),
`created_at__gte` / `created_at__lte`. Sort whitelist: `id`, `title`,
`is_pinned`, `is_private`, `created_at`, `updated_at`.

Permissions: reads — author, anyone in `shared_with`, or any tenant member
for non-private notes; writes — author or `edit`/`admin` share; admin
actions (delete, manage shares) — author or `admin` share only.

Signals (`notes/signals.py`): `post_save` → parses `@<uid>` mentions and
`#hashtag` tokens from `body` and writes them to `mentions` / `hashtags`
via `update()` (no recursion); on create + content updates, captures a
`NoteVersion` snapshot (skipped for soft-delete / restore saves so they
don't pollute the history). Soft-delete saves are detected via
`update_fields <= {deleted_at, updated_at}`.

### Files (`files/`)

`File` model inherits `SoftDeleteTenantModel`. Fields: `name`, `original_name`,
`size` (BigIntegerField), `mime_type` (indexed), `extension`, `storage_key`
(S3 key), `storage_provider` (s3|minio|r2, default minio), `version` (int
default 1), `uploaded_by` (FK User, RESTRICT), `related_module` /
`related_id` (CRM link, nullable), `shared_with` (M2M User through
`FileShare`), `preview_url`, `thumbnail_url`, `is_starred` (default false),
`description` (text nullable), `tags` (JSONField list), `virus_scan_status`
(pending|clean|infected|skipped, default pending), `ocr_text` (text
nullable), `ocr_status` (pending|done|failed|skipped, default skipped),
`deleted_at`. CHECK constraints on `storage_provider`, `virus_scan_status`,
`ocr_status`. Indexes on `(tenant, deleted_at)`, `(tenant, uploaded_by,
-created_at)`, `(tenant, related_module, related_id)`, `(tenant, is_starred)`,
`(tenant, virus_scan_status)`.

`FileShare` through model: `file` FK CASCADE, `user` FK RESTRICT,
`permission` (read|download|admin, default read), `created_at`. Unique on
`(file, user)`. CHECK constraint on `permission`.

`FileVersion` model: `file` FK CASCADE, `version_number` (int), `size`,
`storage_key`, `uploaded_by` (FK User, RESTRICT), `change_summary` (text
nullable), `created_at`. Unique on `(file, version_number)`. Index on
`(file, version_number)`.

`ShareLink` model: `file` FK CASCADE, `token` (unique, indexed), `created_by`
(FK User, RESTRICT), `expires_at` (nullable, indexed), `password_hash`
(nullable), `download_limit` (int nullable), `download_count` (int default 0),
`watermark` (bool default true), `created_at`. Indexes on `(file)`, `(token)`.
Helper properties: `is_expired`, `is_exhausted`.

`DownloadLog` model: `file` FK CASCADE, `user` (FK User, SET_NULL, nullable
for share-link downloads), `ip`, `user_agent`, `share_link` (FK SET_NULL,
nullable), `watermarked` (bool), `created_at`. Indexes on `(file, -created_at)`,
`(user, -created_at)`.

Viewset actions:

| Method | Path                                                  | Description                                          |
|--------|-------------------------------------------------------|------------------------------------------------------|
| GET    | `/api/v1/files/`                                      | List (uploader's or shared-with-caller files)        |
| POST   | `/api/v1/files/`                                      | Create metadata-only (rarely used; prefer `upload`)  |
| GET    | `/api/v1/files/{id}/`                                 | Retrieve                                              |
| PATCH  | `/api/v1/files/{id}/`                                 | Update metadata (name, description, tags, etc.)      |
| DELETE | `/api/v1/files/{id}/`                                 | Soft-delete (uploader or admin share only)           |
| POST   | `/api/v1/files/upload/`                               | Multipart upload → S3 + File row + FileVersion       |
| GET    | `/api/v1/files/{id}/download/`                        | Presigned GET URL (302 redirect) + `DownloadLog`     |
| POST   | `/api/v1/files/{id}/star/`                            | Toggle `is_starred`                                   |
| POST   | `/api/v1/files/{id}/share/`                           | Grant `read`/`download`/`admin` share                 |
| DELETE | `/api/v1/files/{id}/share/`                           | Revoke a share                                        |
| POST   | `/api/v1/files/{id}/create-share-link/`               | Tokenized public-ish link w/ password / expiry / limit / watermark |
| GET    | `/api/v1/files/{id}/version-history/`                 | All `FileVersion` snapshots, newest first             |
| POST   | `/api/v1/files/{id}/restore-version/`                 | Restore `storage_key` + `size` to a previous version  |
| GET    | `/api/v1/files/{id}/preview/`                         | Presigned preview URL + regenerate thumbnail if missing |
| POST   | `/api/v1/files/{id}/ocr/`                             | Manually trigger Tesseract OCR                        |
| POST   | `/api/v1/files/{id}/virus-scan/`                      | Manually trigger ClamAV scan                          |

Filters: `uploaded_by`, `uploaded_by_in`, `related_module`, `related_id`,
`mime_type`, `mime_type__startswith`, `extension`, `is_starred`,
`virus_scan_status`, `ocr_status`, `storage_provider`, `tag`,
`shared_with`, `created_at__gte` / `created_at__lte`, `size__gte` /
`size__lte`. Sort whitelist: `id`, `name`, `size`, `mime_type`,
`is_starred`, `version`, `created_at`, `updated_at`.

Permissions: reads — uploader, anyone in `shared_with`; writes — uploader
or `download`/`admin` share; admin actions (delete, manage shares, create
share links) — uploader or `admin` share only.

Services (`files/services.py`):

- `upload_to_storage(file_obj, key)` — S3/MinIO `put_object` via boto3.
- `generate_presigned_download(key, expires=3600)` — S3 presigned GET URL.
- `generate_thumbnail(file)` — image resize via Pillow; PDF first page via
  PyPDF2 + pdf2image; video frame via ffmpeg (stubbed). Returns the
  thumbnail URL or `""`.
- `watermark_pdf(file_path, user_email)` — overlay a diagonal watermark
  on every page of a PDF via PyPDF2 + reportlab. Returns the new path.
- `extract_text(file)` — Apache Tika HTTP call (server at `TIKA_URL`).
- `scan_virus(file)` — ClamAV scan via clamd TCP socket (host at
  `CLAMAV_HOST:CLAMAV_PORT`). Returns `clean` / `infected` / `skipped`.
- `ocr_document(file)` — Tesseract OCR via pytesseract (image/PDF only).
- `detect_pii(text)` — regex scan for Visa/MC/Amex credit cards, US SSNs,
  and emails. Returns a list of `{type, value}` findings for DLP.

Celery tasks (`files/tasks.py`):

- `process_file_upload(file_id)` — kicked off by the viewset after
  `upload`. Runs virus scan → thumbnail → OCR (image/PDF) → Tika full-text
  extraction → DLP PII scan. Each step is best-effort; failures record
  `skipped` / `failed` statuses and don't break the pipeline.
- `cleanup_old_files()` — daily at 03:45 UTC. Archives files soft-deleted
  >90 days ago to S3 Glacier (via `copy_object` with `StorageClass=GLACIER`)
  and hard-deletes files soft-deleted >7 years ago (DB row + S3 object).

### Attachments (`attachments/`)

`Attachment` model inherits `TenantModel` (NOT soft-deletable — detaching
a file is a hard delete; the underlying `File` row is soft-deletable
separately). Fields: `tenant` (FK Organization, CASCADE), `record_module`
(char: lead|contact|account|deal|task|event|note), `record_id` (char),
`file` (FK File, CASCADE), `attached_by` (FK User, RESTRICT), `description`
(text nullable), `is_inline` (bool default false — embedded in note/email
body), `created_at` / `updated_at`. CHECK constraint on `record_module`.
Unique on `(record_module, record_id, file)` — prevents duplicate
attachments. Indexes on `(tenant, record_module, record_id)`,
`(tenant, file)`, `(tenant, is_inline)`.

Viewset actions:

| Method | Path                                                  | Description                                          |
|--------|-------------------------------------------------------|------------------------------------------------------|
| GET    | `/api/v1/attachments/`                                | List (filter by `record_module` + `record_id`)       |
| POST   | `/api/v1/attachments/`                                | Create (auto-stamps `attached_by`)                    |
| GET    | `/api/v1/attachments/{id}/`                           | Retrieve                                              |
| PATCH  | `/api/v1/attachments/{id}/`                           | Update `description` / `is_inline`                    |
| DELETE | `/api/v1/attachments/{id}/`                           | Hard-delete the link (the File row is untouched)     |
| POST   | `/api/v1/attachments/bulk-download/`                  | POST `{"ids": [...]}` → ZIP (manifest.json of presigned URLs) |

Filters: `record_module`, `record_id`, `file`, `attached_by`, `is_inline`,
`created_at__gte` / `created_at__lte`. Sort whitelist: `id`,
`record_module`, `record_id`, `is_inline`, `created_at`, `updated_at`.

Permissions: any tenant member can read / create; destroy requires the
attacher or an org admin (the base `CRMModelViewSet` already enforces
`IsTenantMember` + `HasPermission("crm.attachments.*")`).

### Storage (S3 / MinIO / R2)

`DEFAULT_FILE_STORAGE = "storages.backends.s3.S3Storage"` (configured in
`config/settings.py`). The `STORAGES` dict sets the default backend to
S3Storage; static files stay on the local-filesystem backend. AWS config:

- `AWS_STORAGE_BUCKET_NAME` — bucket name (env `S3_BUCKET`,
  default `foundation-media`).
- `AWS_S3_ENDPOINT_URL` — MinIO/R2 endpoint (env `S3_ENDPOINT`,
  default `http://minio:9000`).
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — credentials
  (env `S3_ACCESS_KEY` / `S3_SECRET_KEY`).
- `AWS_S3_REGION_NAME`, `AWS_S3_SIGNATURE_VERSION` (s3v4),
  `AWS_S3_FILE_OVERWRITE` (False — unique keys per upload),
  `AWS_QUERYSTRING_AUTH` (True — presign URLs so private buckets work),
  `AWS_IS_GZIPPED` (True).

External integrations (all opt-in via env vars; degrade to `skipped`
when unreachable):

- ClamAV — `CLAMAV_HOST` / `CLAMAV_PORT` (default `clamav:3310`).
- Apache Tika — `TIKA_URL` (default `http://tika:9998`).
- Tesseract — `pytesseract` Python module + the `tesseract` binary on PATH.
- Pillow — for image thumbnails (Pillow Python module).
- PyPDF2 + reportlab — for PDF watermarking.
- pdf2image + poppler — for PDF first-page thumbnails.

### Celery beat schedule (Phase 6)

| Name                       | Task                          | Schedule                       |
|----------------------------|-------------------------------|--------------------------------|
| `files-cleanup-old-files`  | `files.cleanup_old_files`     | Daily at 03:45 UTC             |

The full beat schedule (Phases 3-6) is in `config/settings.py`
`CELERY_BEAT_SCHEDULE`.

### Migrations & seed

Each new app has a `migrations/__init__.py` so `makemigrations` works out
of the box. The first real migration must be generated in a real
environment (`python manage.py makemigrations notes files attachments`).

### Tasks (`tasks/`)

`Task` model inherits `SoftDeleteTenantModel` (tenant FK + timestamps +
`deleted_at` + soft-delete-aware managers). Fields: `title`, `description`,
`due_date`, `reminder`, `reminder_sent_at`, `priority` (low/medium/high/urgent),
`status` (not_started/in_progress/completed/deferred), `assignee` (FK User),
`watchers` (M2M User), `related_module` / `related_id` (CRM link),
`recurrence` (RFC 5545 RRULE), `parent_task` (self FK for subtasks),
`time_spent` (seconds), `timer_started_at`, `checklist` (JSONField list of
`{text, done}`), `tags` (JSONField list), `created_by`, `owner`,
`last_activity`, `completed_at`, `deleted_at`. CHECK constraints on
`priority` and `status`. Indexes on `(tenant, assignee, status)`,
`(tenant, due_date)`, `(tenant, owner, status)`, `(tenant, last_activity)`.

Viewset actions:

| Method | Path                                          | Description                                          |
|--------|-----------------------------------------------|------------------------------------------------------|
| GET    | `/api/v1/tasks/`                              | List (cursor-paginated, filterable, sortable)        |
| POST   | `/api/v1/tasks/`                              | Create                                               |
| GET    | `/api/v1/tasks/{id}/`                         | Retrieve                                             |
| PATCH  | `/api/v1/tasks/{id}/`                         | Partial update                                       |
| DELETE | `/api/v1/tasks/{id}/`                         | Soft delete                                          |
| POST   | `/api/v1/tasks/{id}/complete/`                | Mark completed (stamps `completed_at`)               |
| POST   | `/api/v1/tasks/{id}/defer/`                   | Mark deferred                                        |
| POST   | `/api/v1/tasks/{id}/add-subtask/`             | Create a subtask (sets `parent_task`)                |
| POST   | `/api/v1/tasks/{id}/start-timer/`             | Start the timer (idempotent — 409 if already running)|
| POST   | `/api/v1/tasks/{id}/stop-timer/`              | Stop the timer (accumulates elapsed seconds)        |
| POST   | `/api/v1/tasks/bulk-update/`                  | `{"ids": [...], "fields": {...}}`                    |
| POST   | `/api/v1/tasks/{id}/restore/`                 | Recover from trash (inherited)                       |
| POST   | `/api/v1/tasks/mass-update/`                  | Inherited from `CRMModelViewSet`                     |
| POST   | `/api/v1/tasks/mass-delete/`                  | Inherited from `CRMModelViewSet`                     |

Filters: `assignee`, `assignee_in`, `owner`, `status`, `status_in`,
`priority`, `priority_in`, `related_module`, `related_id`, `parent_task`,
`due_date__gte`/`__lte`/`__isnull`, `reminder__gte`/`__lte`, `has_recurrence`,
`tag`, `created_at__gte`/`__lte`, `completed_at__isnull`. Sort whitelist:
`id`, `title`, `due_date`, `priority`, `status`, `assignee`, `owner`,
`last_activity`, `created_at`, `updated_at`.

Signals (`tasks/signals.py`): `post_save` → on create, log `task.created`
activity on the related CRM record (if `related_module` + `related_id` are
set); on assignee change, log `task.assigned`; on soft-delete/restore, log
`task.deleted` / `task.restored`.

Celery tasks (`tasks/tasks.py`):

- `tasks.generate_recurring_tasks` — daily at 03:00 UTC. For every recurring
  task whose `due_date` has passed, clone a one-off copy at the current
  due_date and advance the original's `due_date` / `reminder` to the next
  occurrence (via `dateutil.rrule`). Idempotent across re-runs.
- `tasks.send_task_reminders` — every 15 minutes. Find tasks with
  `reminder <= now()` AND `reminder_sent_at IS NULL`, dispatch a notification,
  stamp `reminder_sent_at`.
- `tasks.send_daily_digest` — daily at 08:00 UTC. Email each active user a
  digest of their overdue / due-today / due-this-week tasks.

### Events (`events/`)

`Event` model inherits `SoftDeleteTenantModel`. Fields: `title`,
`description`, `start`, `end`, `all_day`, `location`, `attendees` (M2M User
through `EventAttendee`), `external_attendees` (JSONField list of emails),
`recurrence` (RRULE), `reminders` (JSONField list of `{offset_minutes, sent}`),
`conference_url`, `conference_provider` (none/google_meet/zoom/teams),
`related_module` / `related_id`, `status` (confirmed/tentative/cancelled),
`organizer` (FK User), `visibility` (public/private/busy), `last_expanded_at`.
CHECK constraints on `status`, `visibility`, `conference_provider`, and
`end >= start`. Indexes on `(tenant, start)`, `(tenant, organizer)`,
`(tenant, status)`.

`EventAttendee` through model: `event` FK, `user` FK, `response`
(yes/no/maybe/none), `required` (bool), `responded_at`. Unique constraint on
`(event, user)`.

`Meeting` model — **OneToOne profile on `Event`** (chosen over a separate
Meetings model with FK so every Meeting is exactly one Event; the ICS feed
and conflict detection stay single-model; the calendar UI shows Meeting
metadata inline on the Event card). Fields: `event` (OneToOne primary key),
`agenda` (text), `action_items` (JSONField list of `{text, done, assignee_id}`),
`follow_up_tasks_created` (bool), `engagement_score` (float 0–100). CHECK
constraint on the score range.

Viewset actions:

| Method | Path                                          | Description                                          |
|--------|-----------------------------------------------|------------------------------------------------------|
| GET    | `/api/v1/events/`                             | List (filterable by date range / organizer / status) |
| POST   | `/api/v1/events/`                             | Create (auto-generates conference link if provider)  |
| GET    | `/api/v1/events/{id}/`                        | Retrieve                                             |
| PATCH  | `/api/v1/events/{id}/`                        | Partial update                                       |
| DELETE | `/api/v1/events/{id}/`                        | Soft delete                                          |
| GET    | `/api/v1/events/ics-export/`                  | ICS calendar feed of the caller's events             |
| POST   | `/api/v1/events/detect-conflicts/`            | `{start, end, exclude_event_id?}` → conflicting events |
| POST   | `/api/v1/events/{id}/respond/`                | RSVP the caller's attendance (`{response: yes\|no\|maybe}`) |
| GET    | `/api/v1/events/{id}/meeting/`                | Get (lazy-create) the meeting profile                |
| PATCH  | `/api/v1/events/{id}/meeting/`                | Update agenda / action items                         |
| POST   | `/api/v1/events/{id}/restore/`                | Recover from trash (inherited)                       |
| POST   | `/api/v1/events/mass-update/`                 | Inherited                                            |
| POST   | `/api/v1/events/mass-delete/`                 | Inherited                                            |

Filters: `start__gte`/`__lte`, `end__gte`/`__lte`, `organizer`, `organizer_in`,
`status`, `status_in`, `attendee`, `attendee_in`, `related_module`,
`related_id`, `all_day`, `has_recurrence`, `title`. Sort whitelist: `id`,
`title`, `start`, `end`, `status`, `organizer`, `visibility`, `created_at`,
`updated_at`.

Services (`events/services.py`):

- `generate_ics(tenant, user, window_days=365)` — returns an ICS calendar feed
  string of all events the user organizes or attends in the next year. Uses
  the `icalendar` library.
- `detect_conflicts(tenant, user, start, end, exclude_event_id=None)` — returns
  events the user organizes or attends that overlap `[start, end)`. Cancelled
  events and all-day events are excluded from conflict detection.
- `generate_conference_link(provider, event)` — stub that returns a
  deterministic placeholder URL keyed on the event's PK. In production this
  would call the provider's API (Google Calendar / Zoom / Microsoft Graph).

Celery tasks (`events/tasks.py`):

- `events.send_event_reminders` — every 5 minutes. For each event with a
  `reminders` list, find entries where `event.start - now >= offset_minutes`
  and `sent == False`, dispatch a notification to organizer + attendees,
  flip `sent` to `True`.
- `events.generate_recurring_events` — daily at 03:30 UTC. For every recurring
  event whose `start` has passed, clone a one-off copy at the current start
  and advance the original's `start` / `end` to the next occurrence (via
  `dateutil.rrule`). Reset reminder `sent` flags. Idempotent across re-runs.

### Calls (`calls/`)

`Call` model inherits `SoftDeleteTenantModel`. Fields: `subject`, `call_type`
(inbound/outbound/missed), `duration` (seconds), `outcome`
(connected/voicemail/no_answer/busy), `recording_url`, `transcription`,
`sentiment` (positive/neutral/negative, nullable), `attendees` (M2M User),
`related_module` / `related_id`, `voip_provider`, `voip_call_id`, `notes`,
`started_at`, `ended_at`, `created_by`, `deleted_at`. CHECK constraints on
`call_type`, `outcome`, `sentiment`. Indexes on `(tenant, started_at)`,
`(tenant, related_module, related_id)`, `(tenant, voip_call_id)`.

Viewset actions:

| Method | Path                                          | Description                                          |
|--------|-----------------------------------------------|------------------------------------------------------|
| GET    | `/api/v1/calls/`                              | List (filterable by call_type / outcome / date range)|
| POST   | `/api/v1/calls/`                              | Create                                               |
| GET    | `/api/v1/calls/{id}/`                         | Retrieve                                             |
| PATCH  | `/api/v1/calls/{id}/`                         | Partial update                                       |
| DELETE | `/api/v1/calls/{id}/`                         | Soft delete                                          |
| POST   | `/api/v1/calls/log-call/`                     | Quick-create a call from a CRM record                |
| POST   | `/api/v1/calls/{id}/restore/`                 | Recover from trash (inherited)                       |
| POST   | `/api/v1/calls/mass-update/`                  | Inherited                                            |
| POST   | `/api/v1/calls/mass-delete/`                  | Inherited                                            |

Filters: `call_type`, `call_type_in`, `outcome`, `outcome_in`, `sentiment`,
`related_module`, `related_id`, `attendee`, `created_by`, `voip_provider`,
`voip_call_id`, `started_at__gte`/`__lte`, `ended_at__isnull`,
`duration__gte`/`__lte`, `subject`. Sort whitelist: `id`, `subject`,
`call_type`, `outcome`, `started_at`, `ended_at`, `duration`, `created_at`,
`updated_at`.

Signals (`calls/signals.py`): `post_save` → on create, if the call has a
related CRM record (`related_module` + `related_id`), log a `called` activity
on that record; on soft-delete/restore, log `call.deleted` / `call.restored`.

### RRULE recurrence + ICS dependencies

Added to `pyproject.toml`:

- `python-dateutil>=2.9` — `dateutil.rrule.rrulestr` parses RFC 5545 RRULE
  strings; `rrule.after()` / `rrule.between()` compute the next occurrence(s).
- `icalendar>=5.0` — `Calendar` / `Event` classes build the ICS feed; the
  `rrule` property is emitted as a VEVENT `RRULE` line so calendar clients
  (Google Calendar, Apple Calendar, Outlook) expand the series natively.

### Celery beat schedule (Phase 5)

Added to `config/settings.py` `CELERY_BEAT_SCHEDULE`:

| Schedule            | Task                              | Frequency        |
|---------------------|-----------------------------------|------------------|
| `tasks-send-reminders`        | `tasks.send_task_reminders`        | every 15 minutes |
| `tasks-daily-digest`          | `tasks.send_daily_digest`          | daily 08:00 UTC  |
| `tasks-generate-recurring`    | `tasks.generate_recurring_tasks`   | daily 03:00 UTC  |
| `events-send-reminders`       | `events.send_event_reminders`      | every 5 minutes  |
| `events-generate-recurring`   | `events.generate_recurring_events` | daily 03:30 UTC  |

All five tasks iterate per-tenant via `api.managers.tenant_context` so the
ORM tenant scoping (and the activity-log writes from the signal handlers)
is correct.

## What's in Phase 4 (UX layer — still here)

Phase 4 builds the **UX-layer backend** on top of the Phase 3 CRM modules so
the frontend can ship a Linear-grade CRM experience:

- **`crm_ux/`** — saved views, recently-viewed, activity timeline, notes,
  file attachments, record locks, and trash management.

### Saved views

Per-user, per-module list configurations (`{filters, sort, columns, groupBy}`).
Sharable within the tenant. `set-default` action marks the caller's default
view per module (clears any prior default).

### Recently viewed

Auto-upserting "last viewed" pointer per (user, module, record_id) — only the
latest `viewed_at` survives. Powers the "Recently viewed" rail in the sidebar.
`clear` action wipes the caller's history.

### Activity timeline

Append-only `Activity` rows for every CRM record, written by:

- signal handlers on Lead / Contact / Account / Deal (`created` / `updated` /
  `deleted` / `restored`),
- viewset hooks (`note_added`, `file_attached`),
- explicit service calls (`emailed`, `called`, `meeting`, `converted`).

The `GET /api/v1/timeline/{module}/{record_id}/` endpoint merges activities +
notes and groups them into **Today / Yesterday / This Week / Earlier** buckets
for the timeline UI.

### Notes

Notes attached to CRM records. The `body` supports `@<email_or_id>` mentions
and `#hashtags` — both are parsed out on create / update and stored
denormalized in `mentions` (list of user IDs) and `hashtags` (list of tags)
so the frontend can build a "notes mentioning @user" filter without parsing
every note.

### File attachments

S3 / MinIO-backed uploads against any CRM record. The viewset streams the
multipart upload to `default_storage` (configured via `django-storages` /
`boto3`), stores the resulting S3 key + URL + size + MIME type, and logs a
`file_attached` activity.

### Record locks

Cooperative pessimistic locks with a 4-hour TTL (`RECORD_LOCK_TTL`). The
list endpoint purges expired locks on every call. If a non-expired lock
exists for another user, `create` returns **409 Conflict** with the holder's
user ID and the lock's `expires_at`.

### Trash management

The `TrashViewSet` aggregates soft-deleted rows across all four CRM modules
(leads / contacts / accounts / deals). `restore` clears `deleted_at`; `purge`
permanently deletes. A daily Celery beat task (`crm_ux.cleanup_trash`, 02:00
UTC) permanently purges records soft-deleted > 30 days ago — also runnable
manually via `python manage.py cleanup_trash [--days N] [--dry-run]`.

## What's in Phase 3 (CRM modules — still here)

Phase 3 builds **four core CRM modules** on top of the Phase 2 auth surface:

- **`accounts/`** — Account model (customer / prospect / partner / competitor
  / vendor), self-referential `parent_account` hierarchy, soft-delete, tenant-
  scoped indexes on (tenant, deleted_at) / (tenant, owner) / (tenant, type) /
  (tenant, parent).
- **`contacts/`** — Contact model with emails/phones/addresses/social_profiles
  JSON lists, FK to Account, soft-delete, indexes on (tenant, deleted_at) /
  (tenant, account) / (tenant, owner).
- **`leads/`** — Lead model with 5 lead-status values (new/contacted/qualified
  /unqualified/converted), 3 ratings, AI `score` (0-100), `convert_lead`
  action that creates Account + Contact + Deal and marks the lead converted.
  Indexes on (tenant, deleted_at) / (tenant, status, owner) /
  (tenant, owner, created_at) / (tenant, last_activity). CHECK constraints on
  status / rating / score.
- **`deals/`** — Deal model with `Pipeline` + `Stage` (in
  `deals/models_pipeline.py`). Computed properties: `expected_revenue`,
  `age`, `is_won`, `is_lost`, `is_open`. M2M to Contact through `DealContact`.
  CHECK constraints on probability (0-100) and type. Default pipeline
  "Sales Pipeline" with 6 stages: Prospect (10%) → Qualified (25%) → Proposal
  (50%) → Negotiation (75%) → Closed Won (100%) → Closed Lost (0%).
- **`custom_fields/`** — Per-tenant, per-module custom fields with **25 field
  types** (text, long_text, rich_text, number, currency, percent, decimal,
  date, datetime, time, email, phone, url, picklist, multi_picklist, checkbox,
  lookup, subform, formula, rollup_summary, file, image, rating, address).
  Type registry in `custom_fields/registry.py` maps each type → validator +
  DRF serializer field. Per-type validator functions are also re-exported from
  `custom_fields/validators.py` (`validate_email`, `validate_picklist`, …) for
  callers that want a per-type import surface. Services in
  `custom_fields/services.py`: `get_custom_fields`, `get_values` (batch read),
  `set_value` (validate + upsert), `apply_defaults` /
  `apply_defaults_for_module` (migration helper). `post_save` signal on
  `CustomField` enqueues a Celery task to backfill default values for all
  existing records of the field's module.

Cross-cutting features:

- **Soft delete** via `api/soft_delete.py` — `deleted_at` nullable, default
  `objects` manager excludes deleted, `all_objects` includes them. ViewSets
  expose `restore/` to recover from trash.
- **CursorPagination** (page_size 50, max 200) for stable list ordering.
- **`?sort=-created_at,name`** multi-key ordering whitelisted per viewset.
- **`?fields=id,name,email`** dynamic field projection via `DynamicFieldsMixin`.
- **Bulk actions**: `mass-update`, `mass-delete`, `bulk-create`, `restore`,
  `merge` — built into the shared `CRMModelViewSet` base.
- **Custom field filtering**: `?custom_field=api_name:value` on every CRM
  list endpoint.
- **Per-action permissions**: `crm.{module}.{read|create|update|delete}`,
  resolved per HTTP method.
- **OpenAPI 3.1** at `/api/schema/` + Swagger UI at `/api/docs/` + ReDoc at
  `/api/redoc/` (drf-spectacular).

## Quickstart

```bash
cd backend
uv sync
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py setup_rls            # enable PostgreSQL RLS
uv run python manage.py seed_crm             # seed demo CRM dataset
uv run python manage.py runserver 0.0.0.0:8000
```

## What's in Phase 2 (Auth & Identity — still here)

- **Custom user model** (`api.User`, email-based, no `username`).
- **Multi-tenancy** via `Organization` + `TenantMembership` with thread-local
  `tenant_context` and a `TenantManager` that auto-filters by the active
  tenant.
- **PostgreSQL Row-Level Security** as defense-in-depth (`api/rls.py`,
  `python manage.py setup_rls`).
- **Auth methods**: email/password (with optional TOTP 2FA), magic links,
  WebAuthn / passkeys (`webauthn-py`), OAuth via django-allauth (Google,
  Microsoft, Apple, GitHub, LinkedIn), SAML 2.0 (djangosaml2), SCIM 2.0
  (django-scim2-style).
- **JWT**: SimpleJWT with 15-min access / 30-day refresh, refresh rotation +
  blacklisting, per-device revocation.
- **Throttling**: django-axes — 5 failures → 1-hour lockout (per IP+user).
- **Object-level perms**: django-guardian.
- **Field-level security**: `FieldSecurity` model + `FieldLevelPermissions`.
- **Audit log**: `AuditLog` (append-only, tenant-scoped, filterable).
- **Password policy**: complexity, breach check (HIBP k-anonymity), history
  (10), soft expiry (90 days) via `api/validators.py`.
- **API keys**: tenant-scoped, hashed-at-rest, scope-limited, with auto-rotation
  via Celery beat.
- **OpenAPI 3.1** schema at `/openapi.json` (consumed by the frontend's
  openapi-typescript codegen).

## Endpoints

Health: `GET /health/` → `{ "status": "ok", "service": "foundation-backend", "version": "0.3.0", "phase": "crm" }`

OpenAPI: `GET /openapi.json` (hand-curated) • `GET /api/schema/` (drf-spectacular, OpenAPI 3.1) • `GET /api/docs/` (Swagger UI) • `GET /api/redoc/` (ReDoc)

### CRM (under `/api/v1/`)

All CRM endpoints are tenant-scoped (resolved by `TenantMiddleware`) and require `IsAuthenticated + IsTenantMember + HasPermission(crm.{module}.{action})`. They support `?sort=-created_at,name`, `?fields=id,name,email`, `?page_size=50` (max 200), and custom-field filtering via `?custom_field=api_name:value`.

#### Accounts

| Method | Path                                       | Description                                              |
|--------|--------------------------------------------|----------------------------------------------------------|
| GET    | `/api/v1/accounts/`                        | List (cursor-paginated, filterable, sortable)            |
| POST   | `/api/v1/accounts/`                        | Create                                                   |
| GET    | `/api/v1/accounts/{id}/`                   | Retrieve                                                 |
| PATCH  | `/api/v1/accounts/{id}/`                   | Partial update                                           |
| DELETE | `/api/v1/accounts/{id}/`                   | Soft delete                                              |
| POST   | `/api/v1/accounts/{id}/restore/`           | Recover from trash                                       |
| POST   | `/api/v1/accounts/mass-update/`            | `{"ids": [...], "fields": {...}}`                        |
| POST   | `/api/v1/accounts/mass-delete/`            | `{"ids": [...]}`                                         |
| POST   | `/api/v1/accounts/bulk-create/`            | `[{...}, {...}]`                                         |
| POST   | `/api/v1/accounts/merge/`                  | `{"source_id": id, "target_id": id}`                     |
| GET    | `/api/v1/accounts/{id}/hierarchy/`         | Account + immediate children                             |

#### Contacts

| Method | Path                                       | Description                                              |
|--------|--------------------------------------------|----------------------------------------------------------|
| GET    | `/api/v1/contacts/`                        | List                                                     |
| POST   | `/api/v1/contacts/`                        | Create                                                   |
| GET    | `/api/v1/contacts/{id}/`                   | Retrieve                                                 |
| PATCH  | `/api/v1/contacts/{id}/`                   | Partial update                                           |
| DELETE | `/api/v1/contacts/{id}/`                   | Soft delete                                              |
| POST   | `/api/v1/contacts/{id}/restore/`           | Recover                                                  |
| POST   | `/api/v1/contacts/mass-update/`            | Mass update                                              |
| POST   | `/api/v1/contacts/mass-delete/`            | Mass delete                                              |
| POST   | `/api/v1/contacts/bulk-create/`            | Bulk create                                              |
| POST   | `/api/v1/contacts/merge/`                  | Merge two contacts                                       |
| GET    | `/api/v1/contacts/{id}/account/`           | Linked account (if any)                                  |

#### Leads

| Method | Path                                       | Description                                              |
|--------|--------------------------------------------|----------------------------------------------------------|
| GET    | `/api/v1/leads/`                           | List                                                     |
| POST   | `/api/v1/leads/`                           | Create                                                   |
| GET    | `/api/v1/leads/{id}/`                      | Retrieve                                                 |
| PATCH  | `/api/v1/leads/{id}/`                      | Partial update                                           |
| DELETE | `/api/v1/leads/{id}/`                      | Soft delete                                              |
| POST   | `/api/v1/leads/{id}/restore/`              | Recover                                                  |
| POST   | `/api/v1/leads/mass-update/`               | Mass update                                              |
| POST   | `/api/v1/leads/mass-delete/`               | Mass delete                                              |
| POST   | `/api/v1/leads/bulk-create/`               | Bulk create                                              |
| POST   | `/api/v1/leads/merge/`                     | Merge two leads                                          |
| POST   | `/api/v1/leads/{id}/convert/`              | Convert → Account + Contact + (optional) Deal            |

`convert/` payload (all optional): `{"create_deal": true, "deal_name": "...", "deal_amount": "1234.56", "pipeline_id": id, "stage_id": id, "close_date": "2099-01-01"}`. Idempotent — re-converting returns the existing linked records.

#### Deals + Pipelines + Stages

| Method | Path                                       | Description                                              |
|--------|--------------------------------------------|----------------------------------------------------------|
| GET    | `/api/v1/deals/`                           | List (supports `?is_won=true`, `?is_lost=false`, `?is_open=true`) |
| POST   | `/api/v1/deals/`                           | Create                                                   |
| GET    | `/api/v1/deals/{id}/`                      | Retrieve                                                 |
| PATCH  | `/api/v1/deals/{id}/`                      | Partial update                                           |
| DELETE | `/api/v1/deals/{id}/`                      | Soft delete                                              |
| POST   | `/api/v1/deals/{id}/restore/`              | Recover                                                  |
| POST   | `/api/v1/deals/mass-update/`               | Mass update                                              |
| POST   | `/api/v1/deals/mass-delete/`               | Mass delete                                              |
| POST   | `/api/v1/deals/bulk-create/`               | Bulk create                                              |
| POST   | `/api/v1/deals/merge/`                     | Merge two deals                                          |
| POST   | `/api/v1/deals/{id}/change-stage/`         | `{"stage_id": id}` — moves deal along pipeline           |
| POST   | `/api/v1/deals/{id}/add-contact/`          | `{"contact_id": id, "role": "decision_maker"}`          |
| POST   | `/api/v1/deals/{id}/remove-contact/`       | `{"contact_id": id}`                                     |
| GET    | `/api/v1/pipelines/`                       | List pipelines (with nested stages)                      |
| POST   | `/api/v1/pipelines/`                       | Create pipeline                                          |
| GET    | `/api/v1/stages/`                           | List stages                                              |
| POST   | `/api/v1/stages/`                           | Create stage                                             |

#### Custom fields

| Method | Path                                       | Description                                              |
|--------|--------------------------------------------|----------------------------------------------------------|
| GET    | `/api/v1/custom-fields/`                   | List definitions (filter by `?module=lead`)              |
| POST   | `/api/v1/custom-fields/`                   | Create definition                                        |
| GET    | `/api/v1/custom-fields/{id}/`              | Retrieve                                                 |
| PATCH  | `/api/v1/custom-fields/{id}/`              | Update                                                   |
| DELETE | `/api/v1/custom-fields/{id}/`              | Delete                                                   |
| GET    | `/api/v1/custom-fields/schema/?module=X`   | UI-ready schema (incl. DRF field class names)            |
| GET    | `/api/v1/custom-field-values/batch/`       | `?module=X&record_ids=1,2,3` bulk read                   |
| POST   | `/api/v1/custom-field-values/`             | Upsert a value (validates against the type registry)     |

#### CRM UX layer (Phase 4)

All CRM UX endpoints are tenant-scoped and require `IsAuthenticated + IsTenantMember`.

| Method | Path                                       | Description                                              |
|--------|--------------------------------------------|----------------------------------------------------------|
| GET    | `/api/v1/saved-views/`                     | List (caller's own + tenant-shared; `?module=lead`)      |
| POST   | `/api/v1/saved-views/`                     | Create (`{module, name, config, is_shared}`)             |
| GET    | `/api/v1/saved-views/{id}/`                | Retrieve                                                 |
| PATCH  | `/api/v1/saved-views/{id}/`                | Update (owner only)                                      |
| DELETE | `/api/v1/saved-views/{id}/`                | Delete (owner only)                                      |
| POST   | `/api/v1/saved-views/{id}/set-default/`    | Mark as caller's default for the module                  |
| GET    | `/api/v1/recently-viewed/`                 | List (`?module=lead`, `?limit=20`)                       |
| POST   | `/api/v1/recently-viewed/`                 | Upsert (`{module, record_id}`) — bumps `viewed_at`       |
| POST   | `/api/v1/recently-viewed/clear/`           | Wipe caller's history (`?module=lead` to scope)          |
| GET    | `/api/v1/activities/`                      | List (`?module=lead&record_id=1` or `?user=42`)          |
| GET    | `/api/v1/activities/{id}/`                 | Retrieve                                                 |
| GET    | `/api/v1/notes/`                           | List (`?module=lead&record_id=1`)                        |
| POST   | `/api/v1/notes/`                           | Create (parses `@mentions` + `#hashtags` from `body`)    |
| PATCH  | `/api/v1/notes/{id}/`                      | Update (author only; re-parses mentions/hashtags)        |
| DELETE | `/api/v1/notes/{id}/`                      | Delete (author only)                                     |
| GET    | `/api/v1/file-attachments/`                | List (`?module=lead&record_id=1`)                        |
| POST   | `/api/v1/file-attachments/`                | Upload (multipart `file` + `module` + `record_id` → S3)  |
| DELETE | `/api/v1/file-attachments/{id}/`           | Delete (also removes the S3 object)                      |
| GET    | `/api/v1/record-locks/`                    | List (purges expired locks first; `?module&record_id`)   |
| POST   | `/api/v1/record-locks/`                    | Lock (`{module, record_id}`); 409 if held by another     |
| DELETE | `/api/v1/record-locks/{id}/`               | Unlock (lock owner only)                                 |
| GET    | `/api/v1/trash/`                           | List soft-deleted rows (`?module=lead`)                  |
| POST   | `/api/v1/trash/restore/`                   | Body `{module, record_id}` — clears `deleted_at`         |
| POST   | `/api/v1/trash/purge/`                     | Body `{module, record_id}` — permanent delete            |
| GET    | `/api/v1/timeline/{module}/{record_id}/`   | Merged activity + note feed, grouped by date bucket       |

### Blueprint engine (`/api/v1/blueprints/` etc.) — Phase 9

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/blueprints/`                     | List (`?pipeline=<id>&is_active=<bool>`)                  |
| POST   | `/api/v1/blueprints/`                     | Create (requires `blueprints.manage`)                    |
| GET    | `/api/v1/blueprints/{id}/`                | Retrieve (includes nested states + transitions)          |
| PATCH  | `/api/v1/blueprints/{id}/`                | Update (published blueprints are immutable)              |
| DELETE | `/api/v1/blueprints/{id}/`                | Delete                                                   |
| POST   | `/api/v1/blueprints/{id}/publish/`        | Mark active + published (bumps `version`)                |
| POST   | `/api/v1/blueprints/{id}/archive/`        | Set `is_active=False`                                    |
| GET    | `/api/v1/blueprints/{id}/versions/`       | List every version of the blueprint                      |
| POST   | `/api/v1/blueprints/{id}/preview/`        | Dry-run against a sample deal (`{"deal_id": <id>}`)      |
| GET    | `/api/v1/blueprint-states/`               | List (`?blueprint=<id>&state_type=<type>`)               |
| POST   | `/api/v1/blueprint-states/`               | Create                                                   |
| GET    | `/api/v1/blueprint-transitions/`          | List (`?blueprint=<id>&from_state=<id>&to_state=<id>`)   |
| POST   | `/api/v1/blueprint-transitions/`          | Create                                                   |
| GET    | `/api/v1/blueprint-transitions/{id}/field-requirements/` | List                                    |
| POST   | `/api/v1/blueprint-transitions/{id}/field-requirements/` | Create                                  |
| GET    | `/api/v1/blueprint-transitions/{id}/assignments/`        | List                                    |
| POST   | `/api/v1/blueprint-transitions/{id}/assignments/`        | Create                                  |
| GET    | `/api/v1/blueprint-executions/`           | List (`?pipeline=<id>&deal=<id>&owner=<id>&is_complete=<bool>&is_stuck=<bool>`) |
| GET    | `/api/v1/blueprint-executions/{id}/`      | Retrieve                                                 |
| GET    | `/api/v1/blueprint-executions/{id}/available-transitions/` | List transitions from the current state            |
| POST   | `/api/v1/blueprint-executions/{id}/execute-transition/` | `{"to_state": <id>, "reason": "..."}` (requires `blueprints.manage`) |
| GET    | `/api/v1/blueprint-executions/compliance-report/?pipeline=<id>` | Pipeline-wide adoption metrics           |
| GET    | `/api/v1/blueprint-executions/stuck-deals/?pipeline=<id>` | Deals past their state's `time_limit_hours`      |

## Running the test suite

```bash
cd backend
uv sync --group dev
uv run pytest                              # all CRM tests
uv run pytest accounts/tests/              # one app
uv run pytest accounts/tests/test_filters.py   # one file
uv run pytest --cov=accounts --cov=contacts --cov=leads --cov=deals --cov=custom_fields
```

Each CRM app ships with four test modules:

- `tests/test_models.py` — model-level invariants (factories, soft delete,
  tenant scoping, CHECK constraints, computed properties).
- `tests/test_views.py` — viewset / API tests via the shared `request_factory`
  fixture (list/retrieve/create/update/destroy/restore/mass-update/mass-delete/
  bulk-create/merge, plus app-specific actions like `convert_lead` /
  `change-stage` / `add-contact` / `hierarchy`).
- `tests/test_filters.py` — unit tests for the django-filter `FilterSet`
  (exact / icontains / gt / lt / in / range / isnull lookups, JSON containment
  filters, the custom-field filter method, and tenant-scoping).
- `tests/test_serializers.py` — serializer validation (round-trips, rejected
  payloads, custom-field dict handling, owner defaulting).

`seed/tests/test_seed_crm.py` covers the `seed_crm` management command
(idempotency, `--reset`, expected counts). `custom_fields/tests/
test_custom_fields.py` covers the model, registry, services, signal, and view
layers in one module.

Tests use `pytest-django` + `factory-boy`. Shared fixtures live in
`backend/conftest.py` (tenant, admin role, user, authenticated `api_client`,
and a `request_factory` that sets the `X-Organization` header for the
`TenantMiddleware`).

Ruff config: `line-length = 100` is enforced in production code. Tests are
exempted from `E501` (long descriptive function names + `# type: ignore`
annotations push past 100 chars) — see `pyproject.toml`
`[tool.ruff.lint.per-file-ignores]`.

## Seeding demo data

```bash
uv run python manage.py seed_crm            # idempotent
uv run python manage.py seed_crm --reset    # wipe + re-seed
uv run python manage.py seed_crm --org "My Demo" --admin-email me@example.com
```

Creates: 1 demo org (`subdomain=demo`), 1 admin user (`admin@demo.local` /
`DemoAdmin123!`), 1 default pipeline + 6 stages, 30 accounts, 50 contacts,
100 leads, 20 deals.

## Auth endpoints (under `/api/`) — Phase 2

Health: `GET /health/` → `{ "status": "ok", "service": "foundation-backend", "version": "0.3.0", "phase": "crm" }`

OpenAPI: `GET /openapi.json`

### Auth (under `/api/`)

| Method | Path                              | Description                                     |
|--------|-----------------------------------|-------------------------------------------------|
| POST   | `/api/auth/signup/`               | Create user + personal org + owner role         |
| POST   | `/api/auth/login/`                | Email/password login (optional TOTP)            |
| POST   | `/api/auth/refresh/`              | Refresh access token (checks device revocation) |
| POST   | `/api/auth/logout/`               | Blacklist refresh + revoke device               |
| GET    | `/api/auth/me/`                   | Current user + memberships                      |
| POST   | `/api/auth/magic/request/`        | Email a one-time magic link                     |
| POST   | `/api/auth/magic/verify/`         | Consume magic link, issue JWTs                  |
| POST   | `/api/auth/2fa/setup/`            | Generate TOTP secret + QR                       |
| POST   | `/api/auth/2fa/verify/`           | Verify pending TOTP, enable 2FA                 |
| POST   | `/api/auth/2fa/disable/`          | Disable 2FA (re-verify code)                    |
| POST   | `/api/auth/webauthn/register/begin/`  | Begin passkey registration                  |
| POST   | `/api/auth/webauthn/register/finish/` | Verify & persist passkey                     |
| POST   | `/api/auth/webauthn/login/begin/`     | Begin passkey assertion                     |
| POST   | `/api/auth/webauthn/login/finish/`    | Verify assertion, issue JWTs                |

### Account / tenancy

| Method | Path                                       | Description                              |
|--------|--------------------------------------------|------------------------------------------|
| GET    | `/api/organizations/`                      | List user's orgs                         |
| POST   | `/api/organizations/switch/`               | Switch active org (session)              |
| GET    | `/api/users/`                              | List users in tenant (admin)             |
| POST   | `/api/users/`                              | Invite user to tenant (admin)            |
| GET/PUT/DELETE | `/api/users/<id>/`                 | User CRUD                                |
| GET/POST | `/api/roles/`                            | List / create roles                      |
| GET/PUT/DELETE | `/api/roles/<id>/`                 | Role CRUD (system roles can't be deleted)|
| GET    | `/api/audit/`                              | Audit log (filterable: action/actor/since)|
| GET    | `/api/devices/`                            | List current user's devices              |
| DELETE | `/api/devices/<id>/revoke/`                | Revoke a device                          |
| GET    | `/api/api-keys/`                           | List API keys                            |
| POST   | `/api/api-keys/create/`                    | Create API key (returns raw key once)    |
| DELETE | `/api/api-keys/<id>/revoke/`               | Revoke an API key                        |
| GET/PUT | `/api/security/ip-allowlist/`             | Read / update tenant IP allowlist        |

### SCIM 2.0 (`/scim/v2/`)

Bearer-authenticated against `Organization.scim_endpoint_token`.

| Method        | Path                       | Description                          |
|---------------|----------------------------|--------------------------------------|
| GET, POST     | `/scim/v2/Users`           | List / create SCIM users             |
| GET, PUT, PATCH, DELETE | `/scim/v2/Users/<id>` | Retrieve / replace / patch / deactivate |

### SAML 2.0 (`/saml/`)

| Method | Path                | Description                            |
|--------|---------------------|----------------------------------------|
| GET    | `/saml/login/`      | Redirect to the IdP                    |
| POST   | `/saml/acs/`        | Assertion Consumer Service             |
| GET    | `/saml/metadata/`   | SP metadata XML for IdP configuration  |

### OAuth (django-allauth)

Mounted at `/accounts/` — login flows for Google, Microsoft, Apple, GitHub,
LinkedIn. Provider credentials are read from env vars (see below).

## Environment variables

The following env vars are required for full functionality. Copy
`.env.example` to `.env` and fill them in. The defaults are development-only.

### Secrets

```
DJANGO_SECRET_KEY=...
JWT_SIGNING_KEY=...
FIELD_ENCRYPTION_KEY=...   # Fernet key for OAuth access/refresh token encryption
```

### OAuth providers (django-allauth)

```
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
MICROSOFT_OAUTH_CLIENT_ID=...
MICROSOFT_OAUTH_CLIENT_SECRET=...
APPLE_OAUTH_CLIENT_ID=...
APPLE_OAUTH_CLIENT_SECRET=...
APPLE_OAUTH_KEY_ID=...
GITHUB_OAUTH_CLIENT_ID=...
GITHUB_OAUTH_CLIENT_SECRET=...
LINKEDIN_OAUTH_CLIENT_ID=...
LINKEDIN_OAUTH_CLIENT_SECRET=...
```

### SAML

```
SAML2_ENABLED=true
SAML2_ENTITY_ID=https://your-app/saml/metadata/
SAML2_IDP_METADATA_URL=https://idp.example.com/metadata.xml
SAML2_KEY_FILE=/etc/foundation/saml/sp.key
SAML2_CERT_FILE=/etc/foundation/saml/sp.crt
SAML2_XMLSEC_BINARY=/usr/bin/xmlsec1
SAML2_FRONTEND_REDIRECT_URL=https://your-app/auth/saml/callback
```

For multi-tenant SAML, set `SAML2_CONFIG` (in settings.py) to a callable
`config(request) -> dict` that resolves the SP config from the request's
tenant, and optionally `SAML2_TENANT_RESOLVER` to map IdP attributes to an
`Organization`.

### Other

```
CORS_ORIGINS=https://your-app,http://localhost:3000
CSRF_TRUSTED_ORIGINS=https://your-app
DEFAULT_FROM_EMAIL=no-reply@your-app
EMAIL_HOST=...
EMAIL_PORT=...
PASSWORD_BREACH_CHECK_STRICT=false   # set true to fail closed when HIBP is unreachable
```

## Phase 7 — real-time fabric

### Activity feed (`feed/`)

`FeedPost` inherits `TenantModel` (tenant FK + `created_at` / `updated_at`).
Fields: `author` (FK User CASCADE), `body` (text — rich text / HTML),
`mentions` (JSONField list of user IDs — parsed from `@<email_or_id>` tokens
by the `post_save` signal), `hashtags` (JSONField list — parsed from
`#hashtag` tokens), `attachments` (JSONField list of file IDs), `related_module`
/ `related_id` (CRM link, nullable — both blank means the post belongs to the
tenant's *global* feed), `is_pinned` (bool), `likes` (M2M User through
`FeedReaction`), `edited_at` (datetime nullable, stamped on body change),
`deleted_at` (datetime nullable — soft delete). Indexes on `(tenant,
-created_at)`, `(tenant, related_module, related_id)`, `(tenant, author)`,
`(tenant, is_pinned)`, `(tenant, deleted_at)`.

`FeedComment` inherits `TenantModel`. Fields: `post` (FK CASCADE),
`author` (FK User CASCADE), `body` (text), `mentions` (JSONField list — parsed
by signal), `deleted_at` (nullable). Indexes on `(post, created_at)`,
`(post, deleted_at)`.

`FeedReaction` inherits `TenantModel`. Fields: `post` (FK CASCADE, nullable),
`comment` (FK CASCADE, nullable), `user` (FK User CASCADE), `emoji` (char,
default 👍). CHECK constraint enforces exactly one of `post` / `comment` set
(the serializer also validates). Unique on `(tenant, user, post, emoji)` (when
`post` is set) and `(tenant, user, comment, emoji)` (when `comment` is set).
Indexes on `post`, `comment`.

Viewset actions:

| Method | Path                                          | Description                                          |
|--------|-----------------------------------------------|------------------------------------------------------|
| GET    | `/api/v1/feed/posts/`                         | List (cursor-paginated, filter by record / author / hashtag / mention / scope) |
| POST   | `/api/v1/feed/posts/`                         | Create (auto-stamps author + tenant; signal parses mentions) |
| GET    | `/api/v1/feed/posts/{id}/`                    | Retrieve                                              |
| PATCH  | `/api/v1/feed/posts/{id}/`                    | Partial update (author only; stamps `edited_at` on body change) |
| DELETE | `/api/v1/feed/posts/{id}/`                    | Soft delete (author only)                            |
| POST   | `/api/v1/feed/posts/{id}/pin/`                | Toggle `is_pinned`                                    |
| POST   | `/api/v1/feed/posts/{id}/like/`               | Toggle the caller's reaction (default 👍; pass `{"emoji": "❤️"}` for others) |
| POST   | `/api/v1/feed/posts/{id}/add-comment/`        | Add a comment (auto-stamps author + tenant)          |
| GET    | `/api/v1/feed/posts/{id}/comments/`           | List the (paginated) comments on the post            |
| GET    | `/api/v1/feed/comments/`                      | List comments (filter by `?post=`)                   |
| POST   | `/api/v1/feed/comments/`                      | Create (validates post belongs to tenant)            |
| PATCH  | `/api/v1/feed/comments/{id}/`                 | Update (author only)                                  |
| DELETE | `/api/v1/feed/comments/{id}/`                 | Soft delete (author only)                            |
| POST   | `/api/v1/feed/comments/{id}/like/`            | Toggle the caller's reaction                         |
| GET    | `/api/v1/feed/reactions/`                     | List (filter by `?post=` or `?comment=`)             |
| POST   | `/api/v1/feed/reactions/`                     | Create (auto-stamps tenant + user; validates target tenant) |
| DELETE | `/api/v1/feed/reactions/{id}/`                | Delete (reactor only)                                |

Filters: `related_module` + `related_id`, `scope=global` (restricts to posts
with no related record), `author`, `hashtag` (case-insensitive exact, with or
without `#`), `mention` (user ID in mentions JSON list), `post`, `comment`.

Signals (`feed/signals.py`): `post_save` on `FeedPost` → re-parse mentions +
hashtags from the body via `update()` (no recursion); on create with a
related record, log a `note_added` activity via `crm_ux.services.log_activity`.
`post_save` on `FeedComment` → re-parse mentions; on create, dispatch
`mentioned` notifications to each mentioned user and a `commented` notification
to the post's author (unless they're the commenter).

### Notifications (`notifications/`)

`Notification` inherits `TenantModel`. Fields: `actor` (FK User SET_NULL,
nullable — system-generated events), `verb` (char enum — `mentioned` /
`commented` / `liked` / `shared` / `assigned` / `approval_requested` /
`approval_completed` / `created` / `updated` / `uploaded` / `invited` /
`email_received` / `task_due` / `event_reminder`), `target_module` /
`target_id` / `target_name` (polymorphic record pointer), `recipient` (FK User
CASCADE — who receives), `read_at` (datetime nullable — doubles as the archive
timestamp), `channel` (in_app|email|push|sms, default in_app), `data`
(JSONField), `created_at`. Indexes on `(tenant, recipient, read_at)`,
`(tenant, recipient, -created_at)`, `(tenant, -created_at)`.

`NotificationPreference` inherits `TenantModel`. Fields: `user`, `notification_type`
(char enum — `mention` / `comment` / `like` / `assignment` / `approval` /
`file_upload` / `email_received` / `task_due` / `event_reminder`), `in_app`
(bool default true), `email` (bool default true), `push` (bool default false),
`sms` (bool default false), `digest_mode` (immediate|daily|weekly, default
immediate). Unique on `(tenant, user, notification_type)`. Index on
`(tenant, user)`.

`QuietHours` inherits `TenantModel`. Fields: `user`, `start_time` (TimeField),
`end_time` (TimeField), `timezone` (char default UTC), `enabled` (bool
default false). Unique on `(tenant, user)`. Windows that wrap midnight (e.g.
22:00 → 07:00) are supported.

Viewset actions:

| Method | Path                                                  | Description                                          |
|--------|-------------------------------------------------------|------------------------------------------------------|
| GET    | `/api/v1/notifications/`                              | List (cursor-paginated, filter by `?unread_only=true` and `?channel=`) |
| POST   | `/api/v1/notifications/`                              | Create in-app self-notification (rare)               |
| GET    | `/api/v1/notifications/{id}/`                         | Retrieve                                              |
| POST   | `/api/v1/notifications/mark-read/`                    | Body `{"ids": [...]}` (or no body → mark all unread) |
| POST   | `/api/v1/notifications/mark-all-read/`                | Mark every unread notification as read               |
| POST   | `/api/v1/notifications/archive/`                      | Body `{"ids": [...]}` → sets `data.archived=true`    |
| GET    | `/api/v1/notifications/unread-count/`                 | Returns `{"unread_count": N}`                        |
| GET/POST/PUT/PATCH/DELETE | `/api/v1/notification-preferences/`       | CRUD on the caller's preferences (auto-stamps user + tenant) |
| GET    | `/api/v1/quiet-hours/`                                | Returns the caller's quiet-hours row (or `null`)     |
| POST/PUT/PATCH | `/api/v1/quiet-hours/`                         | Upsert the singleton row                             |
| DELETE | `/api/v1/quiet-hours/`                                | Disable quiet hours (`enabled=false`)                |

Services (`notifications/services.py`):

- `create_notification(tenant, actor, verb, target_module, target_id, target_name, recipient=None, recipient_id=None, data=None, channel='in_app')` —
  resolves preferences + quiet hours, creates the in-app notification row
  (always — so the recipient catches up on return), dispatches to the
  caller-requested channel (or every opted-in channel when channel=in_app),
  and broadcasts the in-app row to the recipient's WebSocket group via the
  Channels layer (best-effort).
- `should_send(tenant, user, verb, channel)` — checks `NotificationPreference`
  for the channel + `QuietHours` window (suppresses email/push/sms during
  DND; in-app rows are always allowed).
- `send_push_notification(user, title, body, data)` — pywebpush stub; reads
  subscriptions from `user.profile.preferences["push_subscriptions"]`; no-op
  when pywebpush isn't installed or VAPID keys aren't configured.
- `send_email_notification(user, subject, body)` — dispatches a Celery task
  (`notifications.send_email`) that defers the SMTP send to a worker; falls
  back to a synchronous send if Celery isn't available.
- `send_sms_notification(user, body)` — Twilio stub; reads the recipient phone
  from `user.profile.phone`; no-op when Twilio isn't configured.
- `get_unread_count(user)` — count of unread in-app rows.
- `mark_all_read(user)` — bulk-mark all unread rows as read.

Celery tasks (`notifications/tasks.py`):

- `send_email(user_id, subject, body)` — async SMTP send (max 3 retries, 60s
  back-off). Triggered by `send_email_notification`.
- `send_daily_digest()` — for each user with `digest_mode=daily` + `email=true`,
  email them their unread in-app notifications from the last 24h. Scheduled
  daily at 09:00 UTC (see the Phase 7 beat entry in `config/settings.py`).

### Real-time WebSocket layer (`realtime/`)

`RealtimeConsumer` is an `AsyncJsonWebsocketConsumer` mounted at
`ws/realtime/`. Connection lifecycle:

1. **Connect** — JWT is extracted from `Sec-WebSocket-Protocol` subprotocol
   (`Authorization.Bearer.<jwt>` or `Bearer.<jwt>`), `?token=<jwt>` /
   `?access_token=<jwt>` query string, or `Authorization: Bearer <jwt>` header.
   The user is resolved via SimpleJWT's `AccessToken`. If no token / invalid
   token / inactive user → close with code 4401. A per-user concurrent-
   connection limit (`REALTIME_MAX_CONNECTIONS_PER_USER`, default 5) is
   enforced — the 6th socket is closed with code 4429.
2. **Groups** — every socket joins `user:<id>` (for personal notifications /
   mentions / task assignments) and `org:<tenant_id>` (for org-wide presence
   + record broadcasts). The tenant is resolved from `?tenant_id=<org_id>` or
   falls back to the user's most-recent active `TenantMembership`.
3. **Heartbeat** — the client sends `{"type": "ping"}` every 30s. The
   consumer replies `{"type": "pong", "ts": "<iso8601>"}` and refreshes the
   presence TTLs in Redis (60s TTL — 90s offline grace).
4. **Record subscriptions** — the client sends
   `{"type": "subscribe_record", "module": "deal", "record_id": "42"}` to
   opt into record-scoped broadcasts (cursor updates, typing indicators,
   field-level diffs). Unsubscribe with the symmetric `unsubscribe_record`.
5. **Disconnect** — leaves all groups, prunes the device from the presence
   tracker, clears any cursor the user had on the records they were viewing,
   and (if the user has no other devices) broadcasts an offline presence
   update to the org.

Inbound client message types handled: `ping`, `set_status`, `set_viewing`,
`subscribe_record`, `unsubscribe_record`, `cursor_update`, `typing_indicator`,
`get_online_users`.

Server-side broadcast event types (routed to handler methods on the consumer
by Channels' `type` field, then forwarded to the client as JSON):
`record_created`, `record_updated` (with field-level diff),
`record_deleted`, `mention`, `comment_added`, `reaction_added`,
`task_assigned`, `approval_requested`, `approval_completed`, `file_uploaded`,
`email_received`, `chat_message_received`, `presence_update`, `cursor_update`,
`typing_indicator`, `notification`.

Broadcast helpers (`realtime/broadcast.py`):

- `broadcast_to_user(user_id, event, data)` — send to the user's socket group.
- `broadcast_to_org(org_id, event, data)` — send to every online tenant member.
- `broadcast_to_record(module, record_id, event, data)` — send to the record's
  subscriber group.
- Event-specific convenience wrappers: `push_record_created`,
  `push_record_updated`, `push_record_deleted`, `push_mention`,
  `push_task_assigned`, `push_approval_requested`, `push_approval_completed`,
  `push_file_uploaded`, `push_email_received`, `push_chat_message_received`,
  `push_presence_update`, `push_cursor_update`, `push_typing_indicator`,
  `push_notification`. Each is a thin wrapper over `broadcast_to_*`.

Presence (`realtime/presence.py`): `PresenceTracker` (module-level singleton
`tracker`) uses three Redis data structures:

- `presence:org:{org_id}` — SET of `user_id:device_id` tokens (90s TTL).
  `get_online_users(org_id)` returns the sorted distinct user IDs.
- `presence:status:{user_id}` — HASH with `status` + `message` (60s TTL).
  `set_status`, `get_status`, `is_online`.
- `presence:viewing:{user_id}` — HASH with `module` / `record_id` /
  `record_name` (60s TTL). `set_viewing`, `get_viewing`, `clear_viewing`.

Cursors (`realtime/cursors.py`): `CursorTracker` (singleton `tracker`) stores
cursors in a single Redis HASH per record (`cursor:{module}:{record_id}`).
Each entry is a JSON-encoded `{field, position, color, updated_at}` keyed by
user ID. Cursors auto-expire after 5 seconds of no update; `get_cursors`
filters + prunes stale entries on every read. The HASH itself expires after 1
hour of inactivity so the bucket doesn't leak memory on abandoned records.

### Phase 7 environment variables

```
# Channels — reused from the existing config.
REDIS_URL=redis://redis:6379/0

# Real-time.
REALTIME_MAX_CONNECTIONS_PER_USER=5

# Web Push (VAPID) — generate with `npx web-push generate-vapid-keys`.
PUSH_VAPID_SUBJECT=mailto:noreply@your-app
PUSH_VAPID_PUBLIC_KEY=...
PUSH_VAPID_PRIVATE_KEY=...

# Twilio (SMS — urgent notifications only).
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+15555550100
```

When `PUSH_VAPID_*` / `TWILIO_*` are unset, the corresponding transport
helpers log + no-op — the in-app notification flow is unaffected.

### Celery beat schedule (Phase 7)

| Name                            | Task                              | Schedule          |
|---------------------------------|-----------------------------------|-------------------|
| `notifications-daily-digest`    | `notifications.send_daily_digest` | Daily at 09:00 UTC |

The full beat schedule (Phases 3-7) is in `config/settings.py`
`CELERY_BEAT_SCHEDULE`.

## Phase 8 — pipeline engine

### Stage model additions (`deals/models_pipeline.py`)

`Stage` gains five Phase-8 fields:

- `forecast_category` (char: `pipeline` / `best_case` / `commit` /
  `closed` / `omitted`, default `pipeline`). Drives the forecasting
  view; deals inherit the category from their current stage on every
  transition.
- `is_locked` (bool, default false). When true, deals cannot leave the
  stage via the validated `transition` action. Won/lost stages should
  set this so closed deals stay closed (admins can flip it off to
  re-open a deal).
- `business_days_limit` (PositiveIntegerField, nullable). When set, the
  daily `deals.check_stuck_deals` Celery task flags deals that have
  been in the stage past the limit.
- `color` (char, default `#3b82f6`). Hex colour used by the pipeline UI.
- `icon` (char, blank). Optional icon name for the pipeline UI.

A `forecast_category_valid` CHECK constraint + a `(pipeline,
forecast_category)` index are added. The `clean()` hook now rejects
won stages with a non-`closed` category and lost stages with a
non-`omitted` category (the two terminal categories are reserved for
the terminal stages).

### Deal model additions (`deals/models.py`)

`Deal` gains a `forecast_category` field (mirroring `Stage`'s choices)
+ a `forecast_category_valid` CHECK constraint + a `(tenant,
forecast_category)` index. The field is read-only via the API — it is
derived from the stage on every transition and on create (see
`DealSerializer.create`).

### StageTransition model (`deals/models.py`)

A directed edge in the pipeline graph. Inherits `TenantModel`.

Fields: `pipeline` (FK CASCADE), `from_stage` (FK Stage CASCADE),
`to_stage` (FK Stage CASCADE), `allowed_roles` (JSONField list of role
names; empty = all roles), `conditions` (JSONField dict — see below),
`require_approval` (FK to `ApprovalProcess`, SET_NULL, nullable),
`created_at`. Unique on `(pipeline, from_stage, to_stage)`. Indexes on
`(pipeline, from_stage)` + `(pipeline, to_stage)`.

`conditions` supports six keys: `min_amount` / `max_amount` /
`min_probability` / `max_probability` / `require_account` /
`require_close_date`. Unknown keys are rejected by the serializer. The
`clean()` hook validates `from_stage != to_stage` and that both stages
belong to the transition's pipeline.

### DealStageHistory model (`deals/models.py`)

Append-only audit trail of every stage transition. Inherits
`TenantModel`.

Fields: `deal` (FK Deal CASCADE), `from_stage` (FK Stage SET_NULL,
nullable), `to_stage` (FK Stage SET_NULL, nullable), `changed_by` (FK
User RESTRICT), `changed_at` (datetime, default `now`), `reason` (text
blank), `duration_in_previous_stage` (BigInt, seconds). Indexes on
`(deal, changed_at)` + `(tenant, to_stage, changed_at)` + `(tenant,
deal)`.

Rows are created by `PipelineService.transition_deal` only — never by
the raw ORM. `duration_in_previous_stage` is computed from the prior
history entry's `changed_at` (or `deal.created_at` for the first
transition).

### ApprovalProcess (`approvals/models.py`)

The Phase-8 `deals.ApprovalProcess` stub has been **promoted** to the
canonical `approvals.ApprovalProcess` model in Phase 10. The schema is
extended with `target_model` (deal / lead / contact / account / task /
event), `trigger_criteria` (JSON rule set, same operator vocabulary as
`BlueprintTransition.conditions`), and `version` (bumped on every
publish). `StageTransition.require_approval` and
`BlueprintTransition.require_approval` FKs now point at
`approvals.ApprovalProcess`.

The runtime models (`ApprovalStep` / `ApprovalRequest` /
`ApprovalAction` / `ApprovalDelegation`) and the `ApprovalService`
service layer ship in the `approvals` app — see the Phase 10 section
above for the full API.

### PipelineService (`deals/services.py`)

The canonical service-layer interface for the pipeline engine. All
methods accept plain ORM objects so the service is straightforward to
unit-test without an HTTP layer.

| Method | Returns | Description |
|--------|---------|-------------|
| `transition_deal(deal, to_stage, user, reason="")` | `TransitionResult` | Validate the move (transition exists + role allowed + conditions met + source not locked), update `deal.stage` + `forecast_category`, append a `DealStageHistory` row, log a `deal.stage_changed` activity. Raises `ValidationError` on any failure. |
| `get_available_transitions(deal, user)` | `list[Stage]` | Stages the deal can move to, filtered by the transition graph + the user's role + the conditions. Empty when the source stage is locked. |
| `check_stage_limits(deal)` | `StageLimitReport` | `{stuck, days_in_stage, limit, alert, entered_at, stage_id, stage_name}`. `alert` flips to `True` at 80 % of the limit so the UI can warn early. |
| `get_pipeline_metrics(pipeline, filters=None)` | `dict` | Per-stage `{stage_id, stage_name, forecast_category, count, sum_amount, weighted_value, avg_time_in_stage, conversion_rate, entered, exited}` + overall `{total_count, total_amount, total_weighted, won_count, lost_count, win_rate}`. |
| `get_deal_velocity(pipeline)` | `list[dict]` | One row per stage: `{stage_id, stage_name, order, avg_seconds, exited_count, still_here_count}` — bar-chart data. |
| `get_stage_conversion_rates(pipeline)` | `list[dict]` | One row per stage: `{stage_id, stage_name, total_entered, moved_forward, lost, conversion_rate}` — funnel chart data. |
| `get_win_rate_by_stage(pipeline)` | `list[dict]` | One row per stage sorted by `lost_count` desc: `{stage_id, stage_name, lost_count, won_count, total_exited, loss_rate}` — "where deals die". |
| `get_monthly_trend(pipeline, months=6)` | `list[dict]` | One row per month for the last N months: `{month, count, sum_amount, won_count, won_amount, lost_count}`. Empty months back-filled with zeros. |
| `get_at_risk_deals(pipeline=None, tenant=None)` | `list[dict]` | Deals stuck past their stage limit OR with a passed `close_date` while still open. Each row carries `{deal_id, deal_name, pipeline_id, stage_id, owner_id, amount, close_date, reasons[], days_in_stage, stage_limit}`. |

Supported `filters` keys for `get_pipeline_metrics`: `owner_id`,
`owner_in`, `stage_in`, `forecast_category`, `close_date_gte`,
`close_date_lte`, `amount_gte`, `amount_lte`, `is_open`.

### DRF endpoints (`deals/views.py` + `deals/urls.py`)

`PipelineViewSet` (CRUD + 6 analytics actions):

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/pipelines/` | List (cursor-paginated) |
| POST   | `/api/v1/pipelines/` | Create (auto-stamps tenant) |
| GET    | `/api/v1/pipelines/{id}/` | Retrieve (with nested stages) |
| PATCH  | `/api/v1/pipelines/{id}/` | Update |
| DELETE | `/api/v1/pipelines/{id}/` | Soft delete |
| GET    | `/api/v1/pipelines/{id}/stages/` | List stages ordered by `order` |
| POST   | `/api/v1/pipelines/{id}/stages-reorder/` | `{"stage_ids": [...]}` → re-apply `order` |
| GET    | `/api/v1/pipelines/{id}/metrics/` | Per-stage + overall metrics (optional `?owner=`, `?stage_in=`, `?forecast_category=`, `?close_date_gte=`, `?close_date_lte=`, `?amount_gte=`, `?amount_lte=`, `?owner_in=`) |
| GET    | `/api/v1/pipelines/{id}/velocity/` | Avg time-in-stage bar-chart data |
| GET    | `/api/v1/pipelines/{id}/conversion-rates/` | Per-stage forward-vs-lost conversion rates |
| GET    | `/api/v1/pipelines/{id}/win-rate-by-stage/` | Where deals die — sorted by `lost_count` desc |
| GET    | `/api/v1/pipelines/{id}/monthly-trend/?months=N` | Count + sum per month for the last N months (default 6) |

`StageViewSet` (CRUD + transitions):

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/stages/` | List (cursor-paginated) |
| POST   | `/api/v1/stages/` | Create (auto-stamps tenant) |
| GET    | `/api/v1/stages/{id}/` | Retrieve |
| PATCH  | `/api/v1/stages/{id}/` | Update (probability / color / business_days_limit / forecast_category / icon / is_locked) |
| DELETE | `/api/v1/stages/{id}/` | Soft delete |
| GET    | `/api/v1/stages/{id}/transitions/` | List outgoing transitions |
| POST   | `/api/v1/stages/{id}/transitions/` | Create an outgoing transition (`to_stage`, `allowed_roles`, `conditions`, `require_approval`) |

`StageTransitionViewSet` (CRUD on the directed edges):

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/stage-transitions/` | List (filter by `?pipeline=`, `?from_stage=`, `?to_stage=`) |
| POST   | `/api/v1/stage-transitions/` | Create (auto-stamps tenant) |
| GET    | `/api/v1/stage-transitions/{id}/` | Retrieve |
| PATCH  | `/api/v1/stage-transitions/{id}/` | Update `allowed_roles` / `conditions` / `require_approval` |
| DELETE | `/api/v1/stage-transitions/{id}/` | Delete |

`DealViewSet` (existing CRM CRUD + 4 new pipeline-engine actions):

| Method | Path | Description |
|--------|------|-------------|
| POST   | `/api/v1/deals/{id}/transition/` | `{"to_stage": <id>, "reason": "..."}` — validated move via `PipelineService.transition_deal`. Returns the updated deal + the new history row. Validation failures raise DRF `ValidationError` (HTTP 400). |
| GET    | `/api/v1/deals/{id}/available-transitions/` | List the stages this deal can move to. |
| GET    | `/api/v1/deals/{id}/stage-history/` | Full `DealStageHistory` timeline for the deal. |
| GET    | `/api/v1/deals/at-risk/?pipeline=<id>` | Deals stuck past their stage limit OR with a passed `close_date`. |
| POST   | `/api/v1/deals/{id}/change-stage/` | *(Deprecated — Phase 7)* Direct stage setter. Kept for backward compatibility. |

### Alerts (`deals/alerts.py`)

Three proactive-monitoring entry points:

| Name | Trigger | Recipients | Verb |
|------|---------|------------|------|
| `check_stuck_deals` | Celery beat — daily @ 09:00 UTC | Deal owner + tenant admins | `task_due` |
| `check_overdue_deals` | Celery beat — daily @ 09:05 UTC | Deal owner + tenant admins | `task_due` |
| `check_amount_drops` | `Deal.post_save` signal — on every save | Tenant admins | `updated` |

Tenant admins are resolved as users whose role name (lowercased) is in
`{"admin", "owner"}` *or* whose role carries the `org.admin` permission
— see `api.permissions.is_admin_role`. The platform has no
`User.manager` FK yet; admins serve as the manager proxy until an
org-chart ships.

The amount-drop signal uses a `pre_save` + `post_save` pair (mirroring
the `tasks` app's assignee-change pattern): `pre_save` stashes the
prior amount on the instance; `post_save` compares the two and fires
the notification when the drop exceeds 50 %.

### Celery beat schedule (Phase 8)

| Name | Task | Schedule |
|------|------|----------|
| `deals-check-stuck-deals` | `deals.check_stuck_deals` | daily @ 09:00 UTC |
| `deals-check-overdue-deals` | `deals.check_overdue_deals` | daily @ 09:05 UTC |

`deals.check_amount_drops` is fired on-demand by the `Deal.post_save`
signal — not on the beat schedule.

## Phase 9 — blueprint engine

### Models (`blueprint/models.py`)

All seven models inherit `api.models.TenantModel` (tenant FK +
`created_at` / `updated_at`) and are scoped by
`api.managers.TenantManager`.

**`Blueprint`** — the published state-machine overlay on top of a
`Pipeline`. Fields: `name`, `pipeline` FK (CASCADE), `is_active`
(bool, default false), `is_published` (bool, default false),
`description` (text), `version` (positive int, default 1). Indexes on
`(tenant, pipeline, is_active)`. Partial unique constraint
`blueprint_one_active_per_pipeline` on `(tenant, pipeline)` filtered by
`is_active=True` — only one active blueprint per pipeline. Drafts and
archived versions keep `is_active=False` so historical versions remain
queryable.

**`BlueprintState`** — one row per pipeline `Stage` with typed state
metadata. Fields: `blueprint` FK (CASCADE), `stage` FK (CASCADE),
`state_type` (`normal` / `transitional` / `terminal`, default `normal`),
`entry_actions` (JSON list of action dicts), `exit_actions` (JSON list),
`time_limit_hours` (positive int nullable — drives the stuck-deal
alert), `escalation_blueprint` FK self-nullable (SET_NULL — when the
limit is exceeded the deal may be moved into this blueprint's flow).
Unique on `(blueprint, stage)`. Indexes on `(blueprint,)` +
`(blueprint, state_type)`.

**`BlueprintTransition`** — the directed edge between two
`BlueprintState` rows. Fields: `blueprint` FK (CASCADE), `from_state` FK
BlueprintState (CASCADE), `to_state` FK BlueprintState (CASCADE),
`allowed_roles` (JSON list of role names, empty = all roles),
`conditions` (JSON dict of field-expression rules, e.g.
`{"amount": {"$gt": 50000}}`), `require_fields` (JSON list of field
names that must be non-empty), `require_approval` FK ApprovalProcess
(SET_NULL, nullable), `post_transition_actions` (JSON list of action
dicts). Unique on `(blueprint, from_state, to_state)`. Indexes on
`(blueprint, from_state)` + `(blueprint, to_state)`.

**`BlueprintFieldRequirement`** — structured per-field conditions on a
transition. Fields: `transition` FK (CASCADE), `field_name` (char),
`condition` (`not_empty` / `equals` / `not_equals` / `greater_than` /
`less_than` / `in`, default `not_empty`), `value` (text — the comparison
operand; for `in` it's a comma-separated list). Index on `(transition,)`.
The richer sibling of `BlueprintTransition.require_fields`.

**`BlueprintAssignment`** — per-transition assignment rule. Fields:
`transition` FK (CASCADE), `assign_to` (`role` / `user` / `team` /
`field_value`, default `role`), `assign_value` (char — role name, user
id, team id, or field name depending on `assign_to`). Index on
`(transition,)`.

**`BlueprintTimer`** — per-state timer that fires when a deal overstays
the state. Fields: `state` FK BlueprintState (CASCADE), `hours`
(positive int), `action` (`auto_transition` / `notify` / `escalate`,
default `notify`), `target_state` FK BlueprintState (SET_NULL, nullable
— required when `action=auto_transition`), `notify_roles` (JSON list of
role names — used when `action=notify`), `escalate_to` (char — role name
or user id, used when `action=escalate`). Index on `(state,)`.

**`BlueprintExecution`** — the runtime state machine for a single
`Deal`. Fields: `deal` FK Deal (CASCADE), `blueprint` FK (CASCADE),
`current_state` FK BlueprintState (SET_NULL, nullable — deleting a state
doesn't cascade onto executions), `entered_state_at` (datetime),
`history` (JSON list of `{from_state, to_state, changed_by, changed_at,
reason}` entries), `is_complete` (bool, default false). Unique on
`(deal,)` — one execution per deal. Indexes on `(tenant, current_state)`
+ `(tenant, is_complete)`. The `append_history(...)` helper mutates the
in-place `history` list (callers save separately).

### BlueprintService (`blueprint/services.py`)

The canonical service-layer interface. Stateless — callers pass plain
ORM objects (`Deal`, `BlueprintState`, `User`) and get back either the
mutated execution or a structured result dict.

| Method | Description |
|--------|-------------|
| `validate_transition(deal, to_state, user)` | Validate a move without executing it. Returns `{valid, errors, missing_fields, requires_approval}`. Checks: active blueprint exists for deal's pipeline; execution exists; from_state = execution.current_state; transition exists; user's role in `allowed_roles`; `conditions` evaluate OK against the deal; `require_fields` all non-empty; every `BlueprintFieldRequirement` passes. Sets `requires_approval=True` when the transition has a `require_approval` FK. |
| `execute_transition(deal, to_state, user, reason="")` | Atomic transition — validates (raises `ValidationError` on failure), runs the source state's `exit_actions`, updates `execution.current_state` + `entered_state_at` + `history`, updates `deal.stage` + `forecast_category` (+ probability for terminal stages), logs a `DealStageHistory` row, runs the target state's `entry_actions` + the transition's `post_transition_actions`, applies structured `BlueprintAssignment` rows, logs a `deal.blueprint_transition` activity via `crm_ux.services.log_activity`, dispatches an `approval_requested` notification to tenant admins when `require_approval` is set. Flips `is_complete=True` when the new state is terminal. Returns the updated execution. |
| `get_available_transitions(deal, user)` | List every reachable target state from the deal's current state. Each entry: `{to_state, transition_id, valid, blocked_reason, missing_fields, requires_approval}`. Empty list when the deal is in a terminal state. |
| `enforce_on_create(deal)` | Auto-create a `BlueprintExecution` for a freshly-created deal whose pipeline has an active blueprint. `current_state` is set to the blueprint state that maps to the deal's stage (or the first state if no match). `entered_state_at` defaults to `deal.created_at`. `is_complete=True` when the initial state is terminal. Called by the `Deal.post_save` signal. No-op (returns `None`) when the pipeline has no active blueprint. |
| `check_timers()` | Hourly Celery beat. Iterates every active tenant via `tenant_context`. For each active execution whose `current_state` has any `BlueprintTimer` rows, and for each timer whose `hours` have elapsed since `entered_state_at`: `auto_transition` → `execute_transition` to `target_state` (actor = deal owner or system user); `notify` → dispatch `task_due` notification to every user in `notify_roles`; `escalate` → dispatch `task_due` notification to `escalate_to` (role name or user id). Returns a summary dict `{tenants_processed, timers_fired, auto_transitions, notifications_sent, errors}`. |
| `get_compliance_report(pipeline)` | Returns `{total_deals, in_blueprint, compliant_deals, non_compliant_deals, compliance_rate, stuck_deals}`. `compliant` = deal has a `BlueprintExecution` whose blueprint belongs to the pipeline. `stuck_deals` = count of deals whose current state has exceeded `time_limit_hours`. |
| `get_stuck_deals(pipeline)` | List of deals whose current blueprint state has exceeded `time_limit_hours`. Each entry: `{deal_id, deal_name, execution_id, state_id, stage_name, entered_state_at, hours_in_state, time_limit_hours}`. |
| `evaluate_condition(deal, conditions)` | Helper — evaluate a JSON field-expression blob against a deal. Supports operators `$gt` / `$lt` / `$gte` / `$lte` / `$eq` / `$ne` / `$in` / `$exists`. Returns `(ok, reason)`. |
| `run_actions(actions, deal, context)` | Helper — execute a list of action dicts. Action types: `create_task` (params: title, description, due_date, assignee_id, priority); `send_notification` (params: verb, title, body, recipient_id, recipient_role); `update_field` (params: field_name, value); `assign_to` (params: assign_to, assign_value — uses `_resolve_assignee_id` to map role / user / team / field_value into a user id and sets `deal.owner`). Failures on individual actions are logged + swallowed so a misconfigured action never breaks the transition. |

### DRF endpoints (`blueprint/viewsets.py` + `blueprint/urls.py`)

Four viewsets mount under `/api/v1/`:

`BlueprintViewSet` (CRUD + lifecycle actions; writes require the
`blueprints.manage` permission, reads require only tenant membership):

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/blueprints/?pipeline=<id>&is_active=<bool>` | List (filtered by pipeline / active). |
| POST   | `/api/v1/blueprints/` | Create. Requires `blueprints.manage`. |
| GET    | `/api/v1/blueprints/{id}/` | Retrieve (includes nested states + transitions). |
| PATCH  | `/api/v1/blueprints/{id}/` | Update. Published blueprints are immutable (archive first). |
| DELETE | `/api/v1/blueprints/{id}/` | Delete. |
| POST   | `/api/v1/blueprints/{id}/publish/` | Mark active + published (bumps `version`; deactivates other active blueprints on the same pipeline). |
| POST   | `/api/v1/blueprints/{id}/archive/` | Set `is_active=False` (keeps `is_published` for history). |
| GET    | `/api/v1/blueprints/{id}/versions/` | List every version of the blueprint (by `pipeline`, ordered by `-version`). |
| POST   | `/api/v1/blueprints/{id}/preview/` | Dry-run against a sample deal (`{"deal_id": <id>}`) — returns the transitions the blueprint would permit. |

`BlueprintStateViewSet` (CRUD; requires `blueprints.manage`):

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/blueprint-states/?blueprint=<id>&state_type=<type>` | List (filtered by blueprint / state_type). |
| POST   | `/api/v1/blueprint-states/` | Create. |
| PATCH  | `/api/v1/blueprint-states/{id}/` | Update. |
| DELETE | `/api/v1/blueprint-states/{id}/` | Delete. |

`BlueprintTransitionViewSet` (CRUD + nested collections; requires
`blueprints.manage`):

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/blueprint-transitions/?blueprint=<id>&from_state=<id>&to_state=<id>` | List (filtered). |
| POST   | `/api/v1/blueprint-transitions/` | Create. |
| GET    | `/api/v1/blueprint-transitions/{id}/field-requirements/` | List field requirements. |
| POST   | `/api/v1/blueprint-transitions/{id}/field-requirements/` | Create a field requirement. |
| GET    | `/api/v1/blueprint-transitions/{id}/assignments/` | List assignments. |
| POST   | `/api/v1/blueprint-transitions/{id}/assignments/` | Create an assignment. |

`BlueprintExecutionViewSet` (read-only list / retrieve + runtime
actions):

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v1/blueprint-executions/?pipeline=<id>&deal=<id>&owner=<id>&is_complete=<bool>&is_stuck=<bool>` | List (filtered). |
| GET    | `/api/v1/blueprint-executions/{id}/` | Retrieve. |
| GET    | `/api/v1/blueprint-executions/{id}/available-transitions/` | List the transitions the deal can take from its current state. |
| POST   | `/api/v1/blueprint-executions/{id}/execute-transition/` | `{"to_state": <id>, "reason": "..."}` — execute a transition via `BlueprintService.execute_transition`. Requires `blueprints.manage`. |
| GET    | `/api/v1/blueprint-executions/compliance-report/?pipeline=<id>` | Pipeline-wide adoption metrics. |
| GET    | `/api/v1/blueprint-executions/stuck-deals/?pipeline=<id>` | Deals whose current state has exceeded `time_limit_hours`. |

### Signals (`blueprint/signals.py`)

| Name | Trigger | Behaviour |
|------|---------|-----------|
| `deal_post_save_enforce_blueprint` | `Deal.post_save(created=True)` | Calls `BlueprintService.enforce_on_create(deal)` so a freshly-created deal whose pipeline has an active blueprint gets a `BlueprintExecution`. Skipped on raw loads, updates, soft-delete saves, and deals without a tenant. Failures are caught + logged so the signal never breaks a deal save. |

### Celery beat schedule (Phase 9)

| Name | Task | Schedule |
|------|------|----------|
| `blueprint-check-timers` | `blueprint.run_blueprint_timers` | hourly |

`blueprint.run_blueprint_timers` wraps `BlueprintService.check_timers()`
so the timer sweep runs on a Celery worker rather than on the request
path. The service iterates every active tenant via `tenant_context` so
the ORM tenant scoping is correct.

## SCIM setup

1. As an org admin, generate a bearer token:
   ```python
   from api.scim import generate_scim_bearer_token
   token = generate_scim_bearer_token()
   ```
2. Store the token on the org: `org.scim_endpoint_token = token; org.save()`.
3. Configure your IdP (Okta, Entra ID, etc.) to:
   - Send `Authorization: Bearer <token>` on all SCIM requests.
   - Use base URL `https://your-app/scim/v2/`.
   - Map `userName` → user email; `active` → user active state.

## SAML setup

1. Set `SAML2_ENABLED=true` and the env vars above.
2. Start the backend and visit `/saml/metadata/` — download the XML.
3. Upload the metadata XML to your IdP.
4. Configure your IdP to send assertions to `https://your-app/saml/acs/`.
5. Attribute map (configurable via `SAML2_ATTR_MAP`):
   - `urn:oid:0.9.2342.19200300.100.1.3` (mail) → `email`
   - `urn:oid:2.5.4.3` (CN) or `displayName` → `name`

## Multi-tenancy & RLS

Each request's tenant is resolved by `api/middleware.TenantMiddleware` from, in
order:

1. Subdomain of the Host header (`acme.your-app` → org `acme`).
2. Session `tenant_id` (set by `POST /api/organizations/switch/`).
3. `X-Organization` header (slug or numeric id).
4. Exact custom-domain match (`Organization.custom_domain`).

A subdomain that resolves to an inactive org returns `404`. The active tenant
is bound to a thread-local (`api.managers.tenant_context`), so all
`TenantManager` queries auto-filter.

**Row-Level Security**: as defense-in-depth, `python manage.py setup_rls`
enables PostgreSQL RLS on every `TenantModel` table. RLS uses
`current_setting('app.tenant_id')` (set by the middleware on each request) to
guarantee that even a buggy ORM call cannot leak cross-tenant rows.

## Celery tasks

| Task                                | Schedule | Description                                |
|-------------------------------------|----------|--------------------------------------------|
| `api.cleanup_expired_sessions`      | hourly   | Delete expired magic links + stale devices |
| `api.rotate_api_keys`               | 6-hourly | Delete expired API keys; flag near-expiry  |
| `custom_fields.recompute_formulas`  | hourly   | Recompute formula/rollup custom fields (stub) |
| `crm_ux.cleanup_trash`              | daily @ 02:00 UTC | Permanently purge CRM records soft-deleted >30 days ago |
| `notifications.send_daily_digest`   | daily @ 09:00 UTC | Email each user with `digest_mode=daily` their unread in-app notifications from the last 24h |
| `deals.check_stuck_deals`           | daily @ 09:00 UTC | Notify owners + tenant admins of deals past their `Stage.business_days_limit` |
| `deals.check_overdue_deals`         | daily @ 09:05 UTC | Notify owners + tenant admins of deals whose `close_date` passed while still open |
| `blueprint.run_blueprint_timers`    | hourly   | Fire every `BlueprintTimer` whose `hours` have elapsed since the deal entered its current state — auto-transition / notify / escalate |

`api.send_magic_link` and `api.send_suspicious_login_alert` are triggered
on-demand by the auth views. `custom_fields.backfill_defaults_for_field` is
triggered on-demand by the `CustomField.post_save` signal when a new custom
field with a default value is created. `notifications.send_email` is triggered
on-demand by `notifications.services.send_email_notification`.
`deals.check_amount_drops` is triggered on-demand by the `Deal.post_save`
signal (via a `pre_save` + `post_save` pair in `deals/alerts.py`).
The blueprint app's `blueprint.signals.deal_post_save_enforce_blueprint`
receiver also fires on `Deal.post_save(created=True)` — it auto-creates
a `BlueprintExecution` for a freshly-created deal whose pipeline has an
active blueprint.

## Structure

```
backend/
├── config/        settings, urls, asgi/wsgi, celery
├── api/           auth app + shared CRM infrastructure
│   ├── management/commands/setup_rls.py   # enable PostgreSQL RLS
│   ├── migrations/
│   ├── admin.py
│   ├── crm_base.py       # CRMModelViewSet, CRMCursorPagination, mixins
│   ├── crm_validators.py # validate_emails/phones/address/url shared helpers
│   ├── factories.py      # OrganizationFactory, UserFactory, _current_tenant/_user
│   ├── managers.py       # TenantManager + tenant_context thread-local
│   ├── middleware.py     # TenantMiddleware
│   ├── models.py         # User, Organization, Role, Membership, AuditLog, ...
│   ├── openapi.py        # static OpenAPI 3.1 schema
│   ├── permissions.py    # IsTenantMember / IsOrgAdmin / HasPermission / FieldLevel
│   ├── rls.py            # PostgreSQL RLS SQL helpers
│   ├── saml_views.py     # SAML SP (login, ACS, metadata)
│   ├── scim.py           # SCIM 2.0 user provisioning
│   ├── serializers.py
│   ├── soft_delete.py    # SoftDeleteTenantModel + SoftDeleteTenantManager
│   ├── tasks.py          # tenant-aware Celery tasks
│   ├── urls.py
│   ├── utils.py          # password, magic, totp, webauthn, audit, IP allowlist
│   ├── validators.py     # custom Django password validators
│   └── views.py          # auth + account + admin API views
├── accounts/     CRM accounts app (models, serializers, filters, views, urls,
│                 factories, tests/, migrations/)
├── contacts/     CRM contacts app
├── leads/        CRM leads app (with convert_lead action)
├── deals/        CRM deals app + models_pipeline.py (Pipeline, Stage — Stage carries
│                 forecast_category / is_locked / business_days_limit / color / icon
│                 since Phase 8) + models.py (Deal + Phase 8 StageTransition +
│                 DealStageHistory; the Phase-8 ApprovalProcess stub was promoted to
│                 approvals.ApprovalProcess in Phase 10) + services.py (PipelineService
│                 with transition_deal / available_transitions / check_stage_limits /
│                 get_pipeline_metrics / get_deal_velocity / get_stage_conversion_rates /
│                 get_win_rate_by_stage / get_monthly_trend / get_at_risk_deals) +
│                 alerts.py (check_stuck_deals + check_overdue_deals Celery tasks +
│                 Deal amount-drop signal) + tests/test_pipeline.py (Phase 8 service tests)
├── custom_fields/ custom fields app (models, registry, services, signals, tasks,
│                 serializers, views, urls, factories, validators, tests/, migrations/)
├── crm_ux/        CRM UX app (Phase 4) — saved views, recently-viewed, activities,
│                 notes, file attachments, record locks, trash; services, signals,
│                 viewsets, filters, factories, tasks, management/commands/cleanup_trash.py,
│                 tests/, migrations/
├── tasks/        Productivity app (Phase 5) — tasks with RRULE recurrence, reminders,
│                 timers, subtasks; signals, services, tasks, factories, tests/, migrations/
├── events/       Productivity app (Phase 5) — calendar events + meetings with ICS,
│                 conflict detection, RSVP; services, tasks, factories, tests/, migrations/
├── calls/        Productivity app (Phase 5) — VoIP call logging; signals, factories,
│                 tests/, migrations/
├── notes/        Content app (Phase 6) — collaborative rich-text notes with mentions,
│                 hashtags, sharing, comments, version history; signals, services,
│                 factories, tests/, migrations/
├── files/        Content app (Phase 6) — S3-backed files with versioning, virus scan,
│                 OCR, DLP, watermark; services (boto3, Tika, ClamAV, Tesseract),
│                 tasks (process_file_upload, cleanup_old_files), factories, tests/, migrations/
├── attachments/  Content app (Phase 6) — polymorphic join between CRM records and files;
│                 bulk-download ZIP; factories, tests/, migrations/
├── feed/         Real-time app (Phase 7) — tenant activity feed (posts, comments,
│                 emoji reactions) with mentions + hashtags auto-parsing; signals,
│                 services, viewsets (pin / like / add-comment), factories, tests/, migrations/
├── notifications/ Real-time app (Phase 7) — in-app / email / push / SMS notifications;
│                 Notification + NotificationPreference + QuietHours models;
│                 services (create_notification, should_send, send_push_notification,
│                 send_email_notification, send_sms_notification, get_unread_count);
│                 tasks (send_email, send_daily_digest); viewsets (mark_read /
│                 mark_all_read / archive / unread_count); factories, tests/, migrations/
├── realtime/     Real-time app (Phase 7) — Django Channels WebSocket layer;
│                 RealtimeConsumer (JWT auth via subprotocol/query-string, 5-conn
│                 per-user limit, heartbeat-driven presence TTL, record subscriptions);
│                 PresenceTracker + CursorTracker (Redis-backed); broadcast helpers
│                 for record_created/updated/deleted, mention, comment_added,
│                 reaction_added, task_assigned, approval_requested/completed,
│                 file_uploaded, email_received, chat_message_received, presence_update,
│                 cursor_update, typing_indicator; routing, tests/, migrations/
├── blueprint/    Blueprint engine (Phase 9) — Zoho-Blueprint-equivalent state machine
│                 layered on top of the Phase-8 pipeline graph; models (Blueprint,
│                 BlueprintState, BlueprintTransition, BlueprintFieldRequirement,
│                 BlueprintAssignment, BlueprintTimer, BlueprintExecution);
│                 BlueprintService (validate_transition / execute_transition /
│                 get_available_transitions / enforce_on_create / check_timers /
│                 get_compliance_report / get_stuck_deals / evaluate_condition /
│                 run_actions); viewsets (BlueprintViewSet with publish / archive /
│                 versions / preview actions; BlueprintStateViewSet;
│                 BlueprintTransitionViewSet with field_requirements / assignments
│                 nested actions; BlueprintExecutionViewSet with available_transitions
│                 / execute_transition / compliance_report / stuck_deals actions);
│                 signals (Deal.post_save → enforce_on_create); tasks (Celery
│                 blueprint.run_blueprint_timers — hourly); filters, factories,
│                 tests/{test_models, test_services, test_viewsets}, migrations/
├── approvals/    Approvals app (Phase 10) — multi-step approval workflow engine;
│                 models (ApprovalProcess [promoted from the Phase-8 deals stub],
│                 ApprovalStep, ApprovalRequest, ApprovalAction, ApprovalDelegation);
│                 ApprovalService (submit / approve / reject / delegate / recall /
│                 escalate_expired / get_pending_for_user / get_my_requests);
│                 viewsets (ApprovalProcessViewSet with steps action;
│                 ApprovalRequestViewSet with approve / reject / delegate / recall /
│                 bulk_approve / pending / my_requests / actions actions;
│                 ApprovalDelegationViewSet); signals (ApprovalRequest / ApprovalAction
│                 post_save → crm_ux activity log); tasks (Celery
│                 approvals.escalate_expired — hourly); filters, factories,
│                 tests/{test_models, test_services, test_viewsets}, migrations/
├── validation_rules/ Validation-rules app (Phase 10) — tenant-scoped field validators
│                 (required / regex / range / unique / custom); ValidationService
│                 (evaluate_rule / validate_record / bulk_check / enforce);
│                 ValidationRuleViewSet with test / bulk_check actions; signals
│                 (pre_save on Lead / Contact / Account / Deal → enforce); filters,
│                 factories, tests/{test_models, test_services, test_viewsets}, migrations/
├── assignment_rules/ Assignment-rules app (Phase 10) — auto-assign records via
│                 round_robin / lead_balance / territory / custom strategies;
│                 AssignmentService (evaluate_rules / execute_strategy / assign);
│                 AssignmentRuleViewSet with evaluate action + AssignmentHistoryViewSet;
│                 signals (post_save on Lead / Contact / Account / Deal created=True →
│                 enqueue evaluate_assignment_rules Celery task); filters, factories,
│                 tests/{test_models, test_services, test_viewsets}, migrations/
├── escalation_rules/ Escalation-rules app (Phase 10) — auto-escalate records past
│                 their time_limit_hours (reassign / notify / both); EscalationService
│                 (evaluate_criteria / check_escalations); EscalationRuleViewSet with
│                 dry-run action + EscalationLogViewSet; tasks (Celery
│                 escalation_rules.run_escalation_check — every 15 min); filters,
│                 factories, tests/{test_models, test_services, test_viewsets}, migrations/
├── seed/         seed app — management/commands/seed_crm.py
├── conftest.py   shared pytest fixtures (tenant, user, api_client, request_factory)
├── manage.py
├── Dockerfile
└── pyproject.toml
```

> Phase 10 status: production-grade source artifacts. The Django app cannot run
> in this sandbox (only Next.js on port 3000), so the artifacts are validated
> for syntactic correctness and architectural soundness only. They will run
> via `make dev` in a real environment. The first real migration for the
> Phase 10 additions must be generated in a real environment
> (`python manage.py makemigrations approvals validation_rules assignment_rules escalation_rules`).

---

## Phase 11 — Workflow automation engine

Phase 11 adds two tenant-scoped automation apps on top of the Phase-10 rule
engine:

- **`workflows/`** — the workflow engine. A `WorkflowRule` pairs a *trigger*
  (record_create / record_update / record_delete / field_change / schedule /
  signal / webhook_received / manual / approval_approved /
  approval_rejected / blueprint_transition) with an ordered list of
  `WorkflowAction` rows (18 action types: send_email, update_field,
  create_record, create_task, webhook, custom_function, alert,
  assign_record, send_sms, whatsapp, delay, if_else, loop, http, add_tag,
  remove_tag, subscribe_sequence, notify_team). Every execution is logged in
  `WorkflowExecution` with a per-action `actions_executed` audit log.
- **`scheduled_actions/`** — cron-driven recurring jobs. A `ScheduledJob`
  stores a 5-field UNIX cron expression + an action type + config; the Celery
  beat task `scheduled_actions.run_scheduled_jobs` (every 1 min) finds every
  active job whose `next_run_at` is due, dispatches it via the same
  `WorkflowService.execute_action` dispatch table the workflow engine uses,
  and recomputes `next_run_at` from the cron expression. Every run is logged
  in `ScheduledJobLog`.

### `workflows/` — rule + action + execution

#### Models

- `WorkflowRule` — tenant FK, `name`, `trigger_type` (11 choices),
  `trigger_model` (nullable — which CRM module), `trigger_conditions` (JSON
  condition tree evaluated against the record), `is_active`, `version`,
  `created_by` (FK User), `last_run_at`, `run_count`, `error_count`. Index
  on `(tenant, is_active, trigger_type, trigger_model)`.
- `WorkflowAction` — tenant FK, `rule` FK (CASCADE), `order`, `action_type`
  (18 choices), `config` (JSON — type-specific payload). Index on
  `(rule, order)`.
- `WorkflowExecution` — tenant FK, `rule` FK (SET_NULL), `target_module`,
  `target_id`, `status` (running / completed / failed), `started_at`,
  `completed_at`, `error_message`, `actions_executed` (JSON list of
  per-action `{action_id, action_type, order, status, started_at,
  completed_at, result, error}` entries). Indexes on
  `(tenant, rule, created_at)` + `(tenant, status)`.

#### `WorkflowService`

The canonical service interface, used by the Celery tasks, the signal
handlers, and the viewset actions:

- `evaluate_rules(instance, trigger_type, trigger_model, user=None)` — finds
  matching active rules (same tenant + trigger_type + trigger_model where
  not null, trigger_conditions evaluates true) and enqueues
  `execute_workflow_task` for each.
- `execute_workflow(rule_id, target_module, target_id)` — creates a
  `WorkflowExecution`, loads the rule's ordered actions, runs each via
  `execute_action`, captures per-action results in `actions_executed`,
  updates the rule's `run_count` / `error_count` / `last_run_at`, and alerts
  tenant admins on failure.
- `execute_action(action, context)` — dispatches by `action_type` for all 18
  types. `send_email` / `send_sms` reuse the notifications transports;
  `create_task` creates a `tasks.Task`; `webhook` POSTs a JSON payload with
  HMAC-SHA256 signing + 3× retry; `http` is a generic method/url/headers/body
  call; `alert` fires in-app + email + push via `create_notification`;
  `assign_record` updates the record's `owner`; `add_tag` / `remove_tag`
  mutate the record's `tags` JSONField (gracefully skipped when the record
  has no `tags` field — only `accounts.Account` carries one); `delay`
  suspends the run via a Celery countdown resume; `if_else` evaluates a
  condition and reports the branch; `loop` returns the iteration count;
  `notify_team` notifies every active tenant member.
- `evaluate_conditions(conditions, record_data)` — JSON condition evaluator
  supporting `$eq` / `$ne` / `$gt` / `$lt` / `$in` / `$contains` / `$exists`
  operators and `$and` / `$or` / `$not` boolean composition. Empty
  conditions match every record.
- `get_templates()` — returns 5 pre-built workflow templates (Welcome new
  lead, Follow-up reminder, Win deal celebration, Re-engage dormant lead,
  Approval reminder escalation).
- `get_metrics(rule_id)` — returns `{total_runs, success_rate,
  avg_execution_time, last_run, error_count}`.

#### Signals + tasks

- `signals.py` — `post_save` on Lead / Contact / Account / Deal enqueues
  `evaluate_workflow_rules` with `record_create` (created=True) or
  `record_update` (otherwise); `post_delete` enqueues with `record_delete`.
  Skips raw loads + soft-delete saves.
- `tasks.py` — `evaluate_workflow_rules` (binds `tenant_context`, resolves
  the record, calls `evaluate_rules`) + `execute_workflow_task` (3× retry
  with exponential backoff — 30s / 60s / 120s).

#### API (`/api/v1/workflow-rules/`, `/api/v1/workflow-executions/`)

`WorkflowRuleViewSet` — CRUD + `activate` / `deactivate` / `duplicate` /
`test_run` (POST `{target_module, target_id}` → execute synchronously) /
`history` (execution log) / `metrics` / `templates` / `export_json` /
`import_json`. Writes require the `workflows.manage` permission.

`WorkflowExecutionViewSet` — read-only list / retrieve + `rerun`
(re-execute a failed run with the same target).

### `scheduled_actions/` — cron-driven recurring jobs

#### Models

- `ScheduledJob` — tenant FK, `name`, `cron_expression` (5-field UNIX cron),
  `action_type` (a workflow action type), `config` (JSON — same shape as
  `WorkflowAction.config`), `last_run_at`, `next_run_at`, `status`
  (active / paused), `timezone` (default UTC). Index on
  `(tenant, status, next_run_at)`.
- `ScheduledJobLog` — tenant FK, `job` FK (SET_NULL), `started_at`,
  `completed_at`, `status` (success / failed), `error_message`, `result`
  (JSON). Index on `(job, started_at)`.

#### `ScheduledActionsService`

- `compute_next_run(cron_expression, tz_name, after)` — uses `croniter`
  (falls back to +1 minute when croniter isn't installed) to compute the
  next run datetime in the configured timezone.
- `run_due_jobs(now)` — finds every active job with
  `next_run_at IS NULL OR next_run_at <= now` and dispatches each.
- `run_job(job)` — constructs a throwaway in-memory `WorkflowAction`, calls
  `WorkflowService().execute_action`, writes a `ScheduledJobLog` row,
  recomputes `next_run_at`.

#### Celery beat

`scheduled-actions-check` — every 1 minute. Wraps
`ScheduledActionsService.run_due_jobs`, iterating every active tenant via
`tenant_context` so RLS / audit logs are scoped correctly.

#### API (`/api/v1/scheduled-jobs/`, `/api/v1/scheduled-job-logs/`)

`ScheduledJobViewSet` — CRUD + `pause` / `resume` / `run_now` (dispatch
immediately + return the log row) / `logs` (paginated run history). Writes
require the `scheduled_actions.manage` permission. `perform_create` stamps
the initial `next_run_at` so the beat task picks the job up on its first
tick.

`ScheduledJobLogViewSet` — read-only list / retrieve, filterable by `job`
and `status`.

### Phase 11 status

Production-grade source artifacts. The Django app cannot run in this
sandbox (only Next.js on port 3000), so the artifacts are validated for
syntactic correctness and architectural soundness only. They will run via
`make dev` in a real environment. The first real migration for the Phase 11
additions must be generated in a real environment
(`python manage.py makemigrations workflows scheduled_actions`).

---

## Phase 12 — Custom functions scripting engine

Phase 12 adds the `custom_functions/` app — a tenant-scoped scripting
engine that lets admins write small Python or JavaScript snippets
(a.k.a. *custom functions*) and run them inside a sandboxed execution
environment with a curated CRM / HTTP / KV / email / SMS / log API surface.
Functions are versioned, gated by an admin-approval step before they may
execute from production triggers, and every run is recorded as a
`CustomFunctionExecution` row for audit.

### `custom_functions/` — sandboxed scripting engine

#### Models

- `CustomFunction` — tenant FK, `name`, `description`, `language`
  (`python` / `javascript` / `visual`), `trigger_event` (`manual` /
  `webhook` / `workflow` / `scheduled` / `api`), `code` (text),
  `version` (int default 1), `is_active`, `is_approved` (default
  `False` — production triggers require this to be `True`),
  `created_by` (FK User), `last_executed_at`, `execution_count`,
  `error_count`. Index on `(tenant, is_active, trigger_event)`.
- `CustomFunctionVariable` — tenant FK, `function` FK (CASCADE), `name`,
  `var_type` (`input` / `output`), `data_type` (`string` / `number` /
  `boolean` / `json` / `record`), `description`, `default_value`,
  `is_required`. Unique on `(function, name)`. Index on
  `(function, var_type)`.
- `CustomFunctionExecution` — tenant FK, `function` FK (SET_NULL),
  `trigger`, `input_data` (JSON), `output_data` (JSON, nullable),
  `status` (`running` / `completed` / `failed`), `started_at`,
  `completed_at`, `error_message`, `log_output` (captured stdout),
  `execution_time_ms`. Indexes on `(tenant, function, started_at)` +
  `(tenant, status)`.
- `CustomFunctionVersion` — tenant FK, `function` FK (CASCADE),
  `version`, `code`, `created_by`, `created_at`. Unique on
  `(function, version)`. Index on `(function, version)`.
- `KVStore` — tenant FK, `key`, `value` (text), `updated_at`. Unique on
  `(tenant, key)`. Index on `(tenant, key)`. This is the *only*
  persistent storage the sandbox can write to.
- `HttpAllowlist` — tenant FK, `domain`, `is_active`. Unique on
  `(tenant, domain)`. Index on `(tenant, is_active)`. The sandbox's
  `http.get/post` helper checks the URL's host against this list
  before issuing the request — an empty allowlist means *no outbound
  HTTP* is permitted.
- `HttpCallLog` — tenant FK, `function_execution` FK (SET_NULL), `url`,
  `method`, `status_code`, `request_body_size`, `response_body_size`,
  `created_at`. Index on `(tenant, created_at)`. One row per outbound
  HTTP call made from inside a sandbox execution.

#### `custom_functions/sandbox.py` — execution environment

- `PythonSandbox` — RestrictedPython-based executor. Wraps the user code
  in a `def _cf_run(input_data, crm, http, kv, log, send_email, send_sms):`
  function so `return` works. Builds a curated globals dict:
  * `__builtins__` is replaced with a whitelist (len, range, str, int,
    float, list, dict, set, sorted, filter, map, etc. — no `eval` /
    `exec` / `open` / `__import__` / `getattr` / etc.).
  * Module whitelist: `datetime`, `re`, `json`, `math`.
  * `crm.leads` / `crm.contacts` / `crm.deals` / `crm.accounts` —
    each exposes `get(id)` / `query(**filters)` (capped at 100 rows) /
    `create(**fields)` / `update(id, **fields)` / `delete(id)`. All
    methods filter by tenant_id.
  * `http.get(url, params=None, headers=None, timeout=10)` /
    `http.post(url, body=None, headers=None, timeout=10)` — gated by
    the tenant's `HttpAllowlist`; every call is logged to `HttpCallLog`.
  * `kv.set(key, value)` / `kv.get(key)` / `kv.delete(key)` —
    per-tenant persistent KV store.
  * `log.info(msg)` / `log.error(msg)` — append to the captured stdout
    buffer (also surfaced as `log_output` on the execution row).
  * `send_email(to_email, subject, body)` / `send_sms(to_number, body)`
    — delegate to `notifications.services`.
  * 30-second wall-clock timeout enforced via
    `concurrent.futures.ThreadPoolExecutor`.
  * Falls back to a manual AST walk (rejects `Import` / `ImportFrom` /
    dunder attribute access / forbidden global names) when
    RestrictedPython isn't installed.
- `JavaScriptSandbox` — QuickJS subprocess executor. Wraps the user
  code in an async IIFE `(async function(inputData) { ... })({input})`
  so `return` + `await` both work. Invokes the `qjs --std` CLI via
  `subprocess.run` with the same 30s timeout. Returns a structured
  `SandboxResult` (output / logs / error / execution_time_ms). If
  `qjs` isn't installed on the host the sandbox returns a clean error
  rather than raising.
- `execute_code(code, language, input_data, context)` — top-level
  dispatcher; routes by `language` (`python` / `javascript` / `visual`
  — the last is treated as Python).

#### `custom_functions/services.py` — `CustomFunctionService`

The canonical service interface, used by the viewsets and the webhook
endpoint:

- `execute(function_id, input_data, trigger='manual', user=None)` —
  loads the function (must be active + tenant-visible), enforces the
  approval gate (production triggers `webhook` / `workflow` /
  `scheduled` / `api` raise `PermissionError` unless `is_approved=True`;
  `manual` always bypasses the gate for authoring), creates a
  `CustomFunctionExecution` row in `running` state *before* the
  sandbox runs (so a hung execution is visible), dispatches to
  `execute_code`, then persists the result + logs + status and
  updates the function's `execution_count` / `error_count` /
  `last_executed_at`. Returns the execution.
- `save_version(function, user)` — snapshots `function.code` as a new
  `CustomFunctionVersion` and bumps `function.version`. Called by the
  viewset's `perform_update` before each update lands.
- `restore_version(function, version, user)` — snapshots the current
  code first (so the rollback itself is reversible) then copies the
  historical code back.
- `get_metrics(function_id)` — returns `{total_executions, success_rate,
  avg_execution_time, last_run}`.
- `get_templates()` — returns 5 pre-built function templates: Lead
  Score Calculator, Sync Deal to External System, Generate Invoice
  PDF, Send WhatsApp on Stage Change, Auto-merge Duplicate Contacts.
- `export_json(function)` / `import_json(payload, tenant, user)` —
  serialize / deserialize a function + its declared variables for
  cross-tenant import.

Module-level helpers `kv_get` / `kv_set` / `kv_delete` /
`is_host_allowed` are also exposed for the `KVStoreViewSet` and
external callers.

#### API (`/api/v1/custom-functions/`, `/api/v1/custom-function-executions/`,
`/api/v1/http-allowlist/`, `/api/v1/http-call-logs/`, `/api/v1/kv-store/`)

`CustomFunctionViewSet` — CRUD + `execute` (POST `{input_data, trigger}`
→ run synchronously) / `history` (paginated execution log) / `metrics` /
`templates` / `approve` (admin-only — toggles `is_approved`) /
`versions` (paginated version history) / `restore_version` (POST
`{version}` → roll `code` back) / `export_json` / `import_json` / `test`
(POST `{code, language, input_data}` → execute without saving). Writes
require the `custom_functions.manage` permission. `perform_update`
auto-snapshots the existing code as a `CustomFunctionVersion` before
the update lands.

`CustomFunctionExecutionViewSet` — read-only list / retrieve, filterable
by `function` / `status` / `trigger` / `started_at__gte` / `started_at__lte`.

`HttpAllowlistViewSet` — CRUD. Writes require org admin.

`HttpCallLogViewSet` — read-only list / retrieve, filterable by
`function_execution` / `status_code` / `method` / `created_at__gte`.

`KVStoreViewSet` — CRUD on the per-tenant KV store plus convenience
`get` (GET `?key=...` → `{key, value}`) / `set` (POST `{key, value}`
→ upsert) / `delete` (POST `{key}` → `{deleted: bool}`) actions.

#### Webhook endpoint

`POST /api/v1/custom-functions/<function_id>/webhook/` — external
systems can invoke an approved function via API key. Authentication:
`X-API-Key` header → SHA-256 hash → `ApiKey` lookup. The key's tenant
must match the function's tenant. The function must be `is_active=True`
+ `is_approved=True`. The request body becomes `input_data`; the
trigger is set to `webhook`. Returns the `CustomFunctionExecution`
row (status + output_data + log_output + execution_time_ms).

### Phase 12 status

Production-grade source artifacts. The Django app cannot run in this
sandbox (only Next.js on port 3000), so the artifacts are validated
for syntactic correctness and architectural soundness only. They will
run via `make dev` in a real environment. The first real migration for
the Phase 12 additions must be generated in a real environment
(`python manage.py makemigrations custom_functions`). RestrictedPython
is an optional dependency — install it (`pip install RestrictedPython`)
for the strongest Python sandbox; the manual AST-walk fallback covers
the same escape vectors with a smaller surface. The JavaScript sandbox
requires the `qjs` QuickJS CLI on the host (`apt install quickjs` or
build from source).

## Phase 13 — Email integration + telephony

Phase 13 adds the two communications apps that turn the CRM into a unified
inbox + dialer:

- **`email_integration/`** — IMAP sync, SMTP send, RFC-822 threading,
  open/click/bounce tracking, schedule-send + Gmail-style undo-send,
  per-user signatures, and bulk mail-merge campaigns.
- **`telephony/`** — multi-provider phone numbers (Twilio / Exotel /
  Vonage / Plivo / MSG91), call logging with Whisper transcription +
  sentiment classification, SMS templates with Indian DLT compliance,
  bulk SMS with rate limiting, IVR flow definitions, and call
  analytics.

Both apps are wired into `INSTALLED_APPS` after `custom_functions` and
exposed under `/api/v1/email-accounts/`, `/api/v1/emails/`,
`/api/v1/email-threads/`, `/api/v1/email-signatures/`,
`/api/v1/mail-merge-campaigns/`, `/api/v1/phone-numbers/`,
`/api/v1/calls/`, `/api/v1/sms-templates/`, `/api/v1/sms-messages/`,
and `/api/v1/ivr-flows/`.

### `email_integration/` — connected mailboxes

The six models all inherit `TenantModel + TimestampedModel`:

- **`EmailAccount`** — a connected mailbox (`provider`:
  gmail|outlook|imap|exchange|yahoo|custom). `credentials` is a
  JSONField (the application layer is responsible for encrypting
  sensitive values, mirroring the `OAuthToken` pattern). Indexes
  `(tenant, user, is_active)`.
- **`EmailThread`** — a grouped conversation keyed on the normalized
  subject (Re:/Fwd:/etc. prefixes stripped). Indexes
  `(tenant, last_activity_at)` + `(tenant, related_module, related_id)`.
- **`Email`** — a single RFC-822 message. Direction
  (`inbound`/`outbound`) + an 8-state lifecycle
  (`draft`→`queued`→`sent`→`delivered`/`bounced`→`opened`/`clicked`/`spam`).
  Five indexes covering the inbox / status / record-linkage / from /
  starred query paths. `scheduled_at` for schedule-send;
  `snoozed_until` for inbox-snooze.
- **`EmailSignature`** — per-user HTML signature, one default per user
  (`unique_together = (tenant, user, name)`).
- **`EmailTracking`** — append-only open/click/bounce/spam event log
  written by the tracking pixel + redirect endpoints. Index
  `(email, timestamp)`.
- **`MailMergeCampaign`** — bulk-send a templated email to a list of
  `{email, variables}` recipients. Index `(tenant, status)`.

**`email_integration/services.py`** is the canonical interface:

- `sync_imap(account)` — pulls new mail since `last_synced_at` via the
  stubbed `_imap_fetch_new` adapter, de-dupes by `message_id`,
  creates `Email` rows, auto-links each to a Contact / Lead by parsing
  the from/to/cc addresses, threads them, and stamps
  `last_synced_at`.
- `send_email(account, to, subject, body_html, …)` — if `scheduled_at`
  is set, creates a `queued` row for the beat task to pick up;
  otherwise dispatches via the stubbed `_smtp_send` adapter and
  records a `sent` row.
- `auto_link_to_record(email)` — matches from/to/cc addresses against
  `Contact.emails` and `Lead.emails` JSON lists (containment query on
  `[{email: "..."}]`). Contacts are preferred over Leads.
- `track_open(email_id, ip, user_agent)` / `track_click(email_id, url, ip, user_agent)`
  / `handle_bounce(email_id, reason)` — write `EmailTracking` rows
  and stamp the corresponding lifecycle timestamp on the `Email` row.
  Subsequent opens are tracked but do not overwrite the first-opened
  timestamp.
- `thread_emails(email)` — assigns the email to an `EmailThread` keyed
  on the normalized subject; bumps `email_count` and `last_activity_at`.
- `undo_send(email_id)` — reverts a sent email to `draft` state if
  called within `UNDO_SEND_WINDOW_SECONDS` (5 seconds, Gmail-style).
- `render_template(template, variables)` — substitutes `{{key}}` and
  `${key}` placeholders.

**`email_integration/tasks.py`** — four Celery tasks:

- `sync_all_accounts` (beat every 2 min) — sweeps every active
  `EmailAccount` and pulls new mail.
- `send_scheduled_emails` (beat every 1 min) — dispatches every queued
  email whose `scheduled_at` has elapsed.
- `send_mail_merge_campaign(campaign_id)` — bulk-send a campaign with
  per-recipient variable substitution.
- `check_follow_up_reminders` (beat daily at 09:30 UTC) — surfaces
  emails flagged `needs_follow_up` to their owners.

**`email_integration/viewsets.py`** — five viewsets:

- `EmailAccountViewSet` — CRUD + `POST /{id}/sync/` for an immediate
  IMAP sweep. Writes require `email.manage`.
- `EmailViewSet` — list / retrieve / create + `POST /{id}/send/` /
  `POST /{id}/star/` / `POST /{id}/snooze/` / `POST /{id}/mark_read/` /
  `GET /{id}/thread/` / `POST /{id}/undo_send/` / `POST /{id}/bounce/`.
- `EmailThreadViewSet` — read-only list / retrieve + `GET /{id}/emails/`.
- `EmailSignatureViewSet` — CRUD on per-user signatures.
- `MailMergeCampaignViewSet` — CRUD + `POST /{id}/start/` (async) +
  `POST /{id}/preview/`.

### `telephony/` — multi-provider calls + SMS + IVR

The five models all inherit `TenantModel + TimestampedModel`:

- **`PhoneNumber`** — a number rented from a provider. `capabilities`
  is `{voice, sms, mms, whatsapp}` JSON. `assigned_to_type` /
  `assigned_to_id` route inbound calls to a user / team / IVR flow.
  Index `(tenant, is_active)`.
- **`TelephonyCall`** — a single call leg. Direction
  (`inbound`/`outbound`/`missed`) + a 7-state status
  (`ringing`/`in_progress`/`completed`/`failed`/`busy`/`no_answer`/
  `voicemail`) + outcome (`connected`/`voicemail`/`no_answer`/`busy`).
  `voip_provider` + `voip_call_id` form the external reference key.
  `recording_url` / `transcription` / `sentiment` filled post-call.
  Three indexes: `(tenant, started_at)`,
  `(tenant, related_module, related_id)`, `(tenant, owner_id)`.
- **`SmsTemplate`** — a reusable SMS template. `category`
  (`transactional`/`promotional`/`otp`). `is_approved` +
  `dlt_template_id` enforce Indian DLT compliance —
  `send_sms` rejects unapproved templates with `PermissionError`.
  Index `(tenant, category, is_approved)`.
- **`SmsMessage`** — an inbound/outbound SMS with delivery status
  (`queued`/`sent`/`delivered`/`failed`), per-segment `segments` +
  `cost`, and CRM-record linkage. Indexes `(tenant, sent_at)` +
  `(tenant, to_number)`.
- **`IvrFlow`** — a visual call-flow definition (JSON) attached to a
  `PhoneNumber`. Index `(tenant, is_active)`.

**`telephony/services.py`** is provider-agnostic — the real adapters
live behind the `_provider_create_call` / `_provider_send_sms` /
`_provider_transcribe` hooks:

- `initiate_call(from_number, to_number, …)` — creates an outbound
  `TelephonyCall` in `ringing` state and calls the provider. E.164
  validation on `to_number`.
- `handle_inbound_call(from_number, to_number, call_sid, …)` —
  creates an inbound `TelephonyCall`. If the called number has an
  active `IvrFlow`, the call is handed off to the IVR engine.
- `transcribe_call(call_id)` — calls the Whisper-ASR stub on the
  recording URL and stamps `transcription` + `sentiment` (naive
  keyword classifier: positive / negative / neutral).
- `send_sms(from_number, to_number, body, template?, …)` — if a
  template is supplied, enforces the DLT approval gate, renders the
  body with `{{var}}` substitution, validates length against
  `max_length`, computes GSM-7 segment count, creates an `SmsMessage`,
  and calls the provider.
- `send_bulk_sms(template_id, recipients, from_number, rate_per_sec=10)`
  — rate-limited bulk send with per-recipient variable substitution
  and per-message failure isolation.
- `get_call_analytics(filters)` — returns `total_calls`,
  `avg_duration`, `answer_rate`, `missed_calls`,
  `volume_per_owner`, `peak_hours` (0-23 buckets via
  `ExtractHour`), `outcome_distribution`.

**`telephony/tasks.py`** — four Celery tasks:

- `transcribe_call_task(call_id)` — async transcription wrapper.
- `send_bulk_sms_task(template_id, recipients, from_number, tenant_id)`
  — async bulk-send wrapper (so the HTTP request returns immediately).
- `cleanup_old_recordings` (beat daily at 04:00 UTC) — wipes
  `recording_url` on calls older than 90 days (the call audit row is
  preserved; only the S3 link is cleared so the bucket can be
  lifecycle-policy'd).
- `daily_analytics_snapshot` — daily snapshot of yesterday's call
  analytics (stub for the analytics warehouse).

**`telephony/viewsets.py`** — five viewsets:

- `PhoneNumberViewSet` — CRUD on rented numbers. Writes require
  `telephony.manage`.
- `TelephonyCallViewSet` — list / retrieve / create +
  `POST /click_to_call/` (initiates an outbound call) +
  `POST /{id}/transcription/` (synchronous transcription) +
  `GET /analytics/` (aggregate analytics with optional
  `started_at__gte` / `started_at__lte` / `owner_id` filters).
- `SmsTemplateViewSet` — CRUD + `POST /{id}/approve/` (admin-only DLT
  approval gate).
- `SmsMessageViewSet` — list / retrieve + `POST /send/` (single SMS
  via body or template) + `POST /bulk_send/` (async bulk send).
- `IvrFlowViewSet` — CRUD on IVR flow definitions.

### Phase 13 status

Production-grade source artifacts. The Django app cannot run in this
sandbox (only Next.js on port 3000), so the artifacts are validated
for syntactic correctness and architectural soundness only. They will
run via `make dev` in a real environment. The first real migrations
for the Phase 13 additions must be generated in a real environment
(`python manage.py makemigrations email_integration telephony`).

Provider adapters (IMAP fetch, SMTP send, Twilio / Exotel / Vonage /
Plivo / MSG91 call + SMS APIs, Whisper transcription) are stubbed
behind the `_imap_fetch_new` / `_smtp_send` / `_provider_create_call`
/ `_provider_send_sms` / `_provider_transcribe` hooks in the
respective `services.py` modules — the production deployment wires
the real adapters there. The DLT compliance gate
(`SmsTemplate.is_approved` + `dlt_template_id`) is enforced at the
service layer; an admin-only `approve` action on the
`SmsTemplateViewSet` toggles the flag.


## Phase 14 — Omnichannel (`whatsapp/` + `livechat/` + `social/` + `inbox/`)

Phase 14 promotes the CRM from a multi-channel *communications hub*
(Phase 13: email + telephony) into a true omnichannel *customer
engagement platform*. Four new tenant-scoped apps ship in this phase:

- **`whatsapp/`** — WhatsApp Business API integration. Outbound send
  (text / image / video / document / audio), inbound webhook ingest
  with auto-status-callback application, pre-approved Meta message
  templates, and one-to-many template broadcasts.
- **`livechat/`** — Real-time live chat. Visitor sessions with full
  identity capture (IP / geo / UA / pages visited / referrer), agent
  assignment with status lifecycle (`waiting` → `active` → `ended`),
  canned responses, proactive-invitation rules, and a Channels
  `AsyncJsonWebsocketConsumer` mounted at `ws/livechat/<session_id>/`
  for per-session real-time chat.
- **`social/`** — Social media monitoring + publishing. Mentions /
  DMs / comments on Twitter / LinkedIn / Facebook / Instagram with
  sentiment classification, assignment, response tracking, and a
  scheduled-post queue dispatched by a 1-minute Celery beat task.
- **`inbox/`** — Unified inbox. Aggregates conversations across all
  channels (email / WhatsApp / telephony / livechat / social / SMS)
  into a single conversation surface with cross-channel replies,
  SLA tracking (response + resolution deadlines), internal notes,
  tagging, conversation merging, reusable macros, and analytics
  (avg first-response time, avg resolution time, CSAT proxy, channel
  distribution, daily volume).

All four apps follow the established Phase-13 conventions:
`TenantModel` + `TimestampedModel` + `TenantManager`; provider glue
(Meta Graph API for WhatsApp, Twitter API v2, LinkedIn Marketing API,
Facebook Graph API, Instagram Graph API) is stubbed behind documented
`_provider_*` hooks in each app's `services.py` so production wiring
is a single-function swap.

### `whatsapp/` — WhatsApp Business API

- **`WhatsAppAccount`** — `phone_number_id`, `waba_id`, `access_token`
  (encrypted at the application layer — same convention as
  `api.models.OAuthToken`), `display_name`, `display_phone_number`,
  `quality_rating` (green / yellow / red), `is_verified`, `is_active`.
  Indexes: `(tenant, is_verified)`.
- **`WhatsAppMessage`** — `account` FK (`SET_NULL`), `from_phone` /
  `to_phone`, `body`, `media_file` FK to `files.File` (nullable),
  `message_type` (text / image / video / document / audio / template /
  interactive / location / contacts), `status` (pending / sent /
  delivered / read / failed), `direction` (inbound / outbound),
  `related_module` / `related_id` (polymorphic CRM-record link),
  `template_id`, `error_code` / `error_message`, `timestamp`. Indexes:
  `(tenant, from_phone, timestamp)`, `(tenant, related_module,
  related_id)`.
- **`WhatsAppTemplate`** — `name`, `language`, `category`, `body`,
  `header_type` / `header_text` / `footer_text`, `buttons` (JSON
  list of Meta button specs), `is_approved`, `template_id` (Meta's
  ID). Indexes: `(tenant, is_approved)`. Unique: `(tenant, name,
  language)`.
- **Services** — `send_message(account, to, body, media=None)`,
  `send_template(account, to, template_name, variables)`,
  `handle_webhook(payload)` (parses Meta webhook entries + applies
  status callbacks), `broadcast(account, recipients, template_name,
  variables)`. All provider calls go through `_graph_api_send(account,
  payload)` (stubbed).
- **Viewsets** — `WhatsAppAccountViewSet`, `WhatsAppMessageViewSet`
  (`@action send`, `@action broadcast`, `@action send_template`),
  `WhatsAppTemplateViewSet`.

### `livechat/` — Real-time live chat

- **`ChatSession`** — `visitor_id`, `visitor_name` / `visitor_email` /
  `visitor_phone` / `visitor_ip` / `visitor_geo` (JSON) /
  `visitor_user_agent`, `pages_visited` (JSON list), `referrer`,
  `assigned_to` FK User (`SET_NULL`), `status` (waiting / active /
  ended), `related_module` / `related_id`, `started_at`, `ended_at`,
  `satisfaction_score` (0-5), `transcript` (denormalized text snapshot
  refreshed on `end_session`). Indexes: `(tenant, status)`,
  `(tenant, assigned_to)`, `(tenant, visitor_email)`.
- **`ChatMessage`** — `session` FK (`CASCADE`), `sender` (visitor /
  agent / bot), `body`, `attachments` (JSON list), `timestamp`,
  `is_read`. Indexes: `(session, timestamp)`.
- **`CannedResponse`** — `key`, `body`, `category`. Indexes:
  `(tenant, category)`. Unique: `(tenant, key)`.
- **`ProactiveRule`** — `name`, `conditions` (JSON list of
  `{field, op, value}` predicates), `message`, `is_active`. Indexes:
  `(tenant, is_active)`.
- **Services** — `create_session(visitor_data, tenant=None)`,
  `assign_session(session, user)`, `send_message(session, sender,
  body, attachments=None)` (broadcasts via the channel-layer
  `group_send` API), `end_session(session, satisfaction=None)`
  (rebuilds the transcript), `convert_to_lead(session)` (creates a
  `leads.models.Lead` from visitor data and links the session).
- **`livechat/consumers.py`** — `LiveChatConsumer`
  (`AsyncJsonWebsocketConsumer`) joins the `livechat.{session_id}`
  group on connect, dispatches inbound `message` / `ping` types,
  and fans out `chat_message` events broadcast by the service layer.
  JWT auth mirrors `realtime.consumers.RealtimeConsumer` (query
  string `?token=`, `jwt.` subprotocol, or `Authorization: Bearer`
  header).
- **`livechat/routing.py`** — registers `ws/livechat/<session_id>/`.
  Mounted in `realtime/routing.py` (alongside `ws/realtime/`) so a
  single `ProtocolTypeRouter` in `config/asgi.py` serves both.
- **Viewsets** — `ChatSessionViewSet` (`@action assign`, `@action
  end`, `@action convert_to_lead`, `@action messages`), `ChatMessageViewSet`,
  `CannedResponseViewSet`, `ProactiveRuleViewSet`.

### `social/` — Social monitoring + publishing

- **`SocialAccount`** — `provider` (twitter / linkedin / facebook /
  instagram), `handle`, `access_token` (encrypted at the application
  layer), `is_active`. Indexes: `(tenant, provider, is_active)`.
  Unique: `(tenant, provider, handle)`.
- **`SocialMention`** — `account` FK (`SET_NULL`), `provider`,
  `message_id`, `author` / `author_handle`, `body`, `media` (JSON
  list), `url`, `sentiment` (positive / neutral / negative),
  `is_read`, `assigned_to` FK User, `related_module` /
  `related_id`, `created_at`, `responded_at`. Indexes: `(tenant,
  provider, created_at)`, `(tenant, is_read)`. Unique: `(tenant,
  provider, message_id)`.
- **`ScheduledPost`** — `account` FK (`CASCADE`), `content`, `media`
  (JSON list), `scheduled_at`, `status` (scheduled / posted / failed),
  `posted_at`, `error_message`. Indexes: `(tenant, scheduled_at)`.
- **Services** — `sync_mentions(account)` (de-duplicates by
  `(tenant, provider, message_id)`, classifies sentiment via
  `analyze_sentiment`), `respond_to_mention(mention, body)`,
  `schedule_post(account, content, scheduled_at, media=None)`,
  `publish_due_posts()` (dispatches every scheduled post whose
  `scheduled_at` has elapsed; per-post failure isolation),
  `analyze_sentiment(text)` (keyword-stub classifier — production
  swaps in an LLM call). Provider glue:
  `_provider_fetch_mentions`, `_provider_reply_to_mention`,
  `_provider_publish_post`.
- **Celery tasks** — `sync_all_mentions` (beat every 5 min),
  `publish_scheduled_posts` (beat every 1 min).
- **Viewsets** — `SocialAccountViewSet` (`@action sync`),
  `SocialMentionViewSet` (`@action respond`, `@action mark_read`,
  `@action assign`), `ScheduledPostViewSet`.

### `inbox/` — Unified inbox

- **`UnifiedConversation`** — `channel` (email / whatsapp / telephony
  / livechat / social / sms), `external_id` (channel-native
  conversation handle), `subject`, `participant_name` /
  `participant_identifier` (canonical customer address), `assigned_to`
  FK User, `status` (open / pending / resolved / closed), `priority`
  (low / normal / high / urgent), `sla_response_deadline` /
  `sla_resolution_deadline`, `tags` (JSON list), `internal_notes`
  (JSON list of `{author, body, timestamp}`), `related_module` /
  `related_id`, `is_merged`, `merged_into` (self FK, nullable),
  `last_message_at`, `message_count`. Indexes: `(tenant, channel,
  status)`, `(tenant, assigned_to)`, `(tenant, last_message_at)`.
  Unique: `(tenant, channel, external_id)`.
- **`UnifiedMessage`** — `conversation` FK (`CASCADE`), `channel`,
  `sender` (customer / agent / bot / system), `body`, `attachments`
  (JSON), `timestamp`, `is_read`, `metadata` (JSON). Indexes:
  `(conversation, timestamp)`.
- **`InboxMacro`** — `name`, `actions` (JSON list of `{type, params}`
  objects), `created_by` FK User. Indexes: `(tenant)`. Unique:
  `(tenant, name)`. Recognized action types: `assign`,
  `set_status`, `set_priority`, `add_tag`, `send_reply`,
  `add_internal_note`.
- **Services** — `get_conversations(filters)` (unified query across
  channels, excludes merged by default), `send_reply(conversation,
  body, channel=None, user=None)` (auto-detects channel or uses
  specified; delegates to the underlying channel app's service
  layer — `email_integration.services.send_email` for email,
  `whatsapp.services.send_message` for WhatsApp,
  `livechat.services.send_message` for livechat,
  `social.services.respond_to_mention` for social; telephony/SMS
  replies are logged only), `assign_conversation(conversation,
  user)`, `merge_conversations(source, target)` (re-parents every
  `UnifiedMessage` from source to target, flips `is_merged=True` +
  `merged_into=target`, recomputes counts/timestamps), `check_sla_breaches()`
  (counts response + resolution SLA breaches), `get_analytics(filters)`
  (avg first-response seconds, avg resolution seconds, CSAT proxy,
  channel distribution, daily volume), `execute_macro(macro_id,
  conversation_id, user=None)` (applies every action in the macro).
- **Celery tasks** — `check_sla_breaches_task` (beat every 5 min).
- **Viewsets** — `UnifiedConversationViewSet` (`@action messages`,
  `@action send_reply`, `@action assign`, `@action tag`, `@action
  snooze`, `@action merge`, `@action close`, `@action analytics`),
  `UnifiedMessageViewSet`, `InboxMacroViewSet` (`@action execute`).

### Endpoint inventory (Phase 14)

- `GET/POST /api/v1/whatsapp-accounts/`
- `GET/POST /api/v1/whatsapp-messages/` + `POST /send/`, `POST /broadcast/`,
  `POST /{id}/send_template/`
- `GET/POST /api/v1/whatsapp-templates/`
- `GET/POST /api/v1/chat-sessions/` + `POST /{id}/assign/`,
  `POST /{id}/end/`, `POST /{id}/convert_to_lead/`,
  `GET|POST /{id}/messages/`
- `GET/POST /api/v1/chat-messages/`
- `GET/POST /api/v1/canned-responses/`
- `GET/POST /api/v1/proactive-rules/`
- `GET/POST /api/v1/social-accounts/` + `POST /{id}/sync/`
- `GET/POST /api/v1/social-mentions/` + `POST /{id}/respond/`,
  `POST /{id}/mark_read/`, `POST /{id}/assign/`
- `GET/POST /api/v1/scheduled-posts/`
- `GET/POST /api/v1/inbox-conversations/` + `GET|POST /{id}/messages/`,
  `POST /{id}/send_reply/`, `POST /{id}/assign/`, `POST /{id}/tag/`,
  `POST /{id}/snooze/`, `POST /{id}/merge/`, `POST /{id}/close/`,
  `GET /analytics/`
- `GET/POST /api/v1/inbox-messages/`
- `GET/POST /api/v1/inbox-macros/` + `POST /{id}/execute/`
- WebSocket: `ws/livechat/<session_id>/?token=<JWT>` (per-session
  chat room).

### Celery beat schedule (Phase 14 additions)

| Entry                       | Task                              | Schedule              |
| --------------------------- | --------------------------------- | --------------------- |
| `social-sync-mentions`      | `social.sync_all_mentions`        | every 5 minutes       |
| `social-publish-scheduled`  | `social.publish_scheduled_posts`  | every 1 minute        |
| `inbox-check-sla`           | `inbox.check_sla_breaches_task`   | every 5 minutes       |

### Permissions

Writes across all four apps are gated by the corresponding
`HasPermission("X.manage")` check (`whatsapp.manage` /
`livechat.manage` / `social.manage` / `inbox.manage`). Read access
(list / retrieve / read-only detail actions) requires only
`IsAuthenticated` + `IsTenantMember`.

### Phase 14 status

Production-grade source artifacts. The Django app cannot run in this
sandbox (only Next.js on port 3000), so the artifacts are validated
for syntactic correctness and architectural soundness only. The first
real migrations for the Phase 14 additions must be generated in a
real environment (`python manage.py makemigrations whatsapp livechat
social inbox`).

Provider adapters (Meta Graph API for WhatsApp, Twitter API v2,
LinkedIn Marketing API, Facebook Graph API, Instagram Graph API) are
stubbed behind documented `_provider_*` hooks in each app's
`services.py` — production deployment wires the real adapters there.
The unified inbox's `send_reply` delegates to the underlying channel
app's service layer (e.g. `email_integration.services.send_email`
for email replies), so a single function swap in the channel app
upgrades the unified inbox's outbound capability.

## Phase 15 — Reports + analytics (`reports/` + `analytics/`)

Phase 15 adds two new apps: a tenant-scoped **report builder** with 12 chart
types, 4 export formats, sharing, subscriptions, and cron scheduling, and a
**pre-built analytics dashboards** layer that surfaces 12 sales / activity
datasets (sales funnel, win/loss, lead conversion, sales cycle, deal-size
distribution, rep performance, activity heatmap, pipeline velocity, source
ROI, email engagement, call analytics, cohort retention).

### `reports/` — report builder

**Models** (`reports/models.py`, all `TenantModel` + `TimestampedModel`):

| Model | Purpose | Key fields / indexes |
|-------|---------|----------------------|
| `Report` | Saved report definition | `source_model` (8 choices), `report_type` (7 choices), `fields`/`filters`/`group_by`/`order_by`/`aggregates`/`having` JSON blobs, `limit`/`offset`, `chart_type` (12 + none), `chart_config`, `schedule_cron`, `shared_with`, `folder` FK, `is_active`/`is_published`, `created_by` FK, `last_run_at`. Indexes `(tenant,is_active,is_published)`, `(tenant,created_by)`. |
| `ReportFolder` | Self-referential folder tree | `name`, `parent` self-FK CASCADE, `created_by`. Index `(tenant,parent)`. |
| `ReportSubscription` | User opt-in for e-mailed results | `report` FK CASCADE, `user` FK CASCADE, `email_on_run`. Unique `(report,user)`. |
| `ReportExecution` | Per-run audit row | `report` FK SET_NULL, `executed_by`, `status` (running/completed/failed), `row_count`, `execution_time_ms`, `result_data` JSON, `error_message`, `started_at`/`completed_at`. Index `(report,started_at)`. |

**Service layer** (`reports/services.py`):

* `ReportService.execute_report(report, *, limit=None, offset=None, user=None, persist=True)` → `{columns, rows, total, chart_data}`. Writes a `ReportExecution` audit row when `persist=True`.
* `ReportService.export_report(report, *, fmt='csv', limit=None)` → `bytes`. Formats: `csv` (csv.writer), `json`, `xlsx` (Excel 2003 SpreadsheetML — no openpyxl dependency), `pdf` (stub — production wires reportlab/weasyprint).
* `ReportService.schedule_report(report, *, user=None)` → Celery task-id. Dispatches `reports.run_scheduled_report` which executes + e-mails subscribers.
* `build_query(report)` → ORM queryset with field selection + filter tree + group-by + 6 aggregates (sum/avg/count/count_distinct/min/max) + HAVING + order-by + limit/offset.
* `evaluate_filter_tree(tree, queryset)` → recursive AND/OR. Leaf operators: `eq`/`ne`/`contains`/`startswith`/`endswith`/`isnull`/`in`/`between`/`gt`/`lt`/`gte`/`lte`/`regex` (13 total).
* `generate_chart_data(report, rows)` → chart-specific payload for `bar`/`line`/`pie`/`funnel`/`gauge`/`heatmap`/`scatter`/`treemap`/`sankey`/`radar`/`waterfall` (returns `{}` for `none`).
* `run_scheduled_report(report_id, user_id)` — Celery task body.

**Pre-built analytics** (`reports/analytics_queries.py`) — 12 functions, all
tenant-scoped, JSON-serialisable:

| Function | Output shape |
|----------|--------------|
| `sales_funnel(tenant)` | `{stages: [[label,count],...], conversions: [{from,to,count,conversion_rate}], overall}` |
| `win_loss_analysis(tenant, group_by='reason')` | `{group_by, rows: [{label,won,lost,win_rate}]}` — supports reason/rep/stage/source/industry/deal_size |
| `lead_conversion_rate(tenant, group_by='source')` | `{group_by, rows: [{label,total,converted,rate}]}` — source/time/rep/industry |
| `sales_cycle_length(tenant, group_by='stage')` | `{group_by, rows: [{label,avg_days,min_days,max_days,count}]}` — Python-computed for SQLite/Postgres portability |
| `deal_size_distribution(tenant, bins=10)` | `{labels, counts, min, max}` — histogram |
| `rep_performance(tenant)` | `{rows: [{rep_id,deals,won,revenue,calls,emails,meetings,lead_conversion_rate}]}` |
| `activity_heatmap(tenant)` | `{x: [Sun..Sat], y: [00:00..23:00], values: 7×24 matrix}` |
| `pipeline_velocity(tenant)` | `{series: {stage-N: [{x:week,y:count}]}}` |
| `source_roi(tenant)` | `{rows: [{label,revenue,deals}]}` |
| `email_engagement(tenant, group_by='template')` | `{group_by, rows: [{label,sent,opens,clicks,replies,open_rate,click_rate,reply_rate}]}` |
| `call_analytics(tenant)` | `{rows: [{rep_id,calls,avg_duration_secs,total_duration_secs}], outcomes: [{outcome,count}]}` |
| `cohort_retention(tenant, months=12)` | `{matrix: [{cohort,size,months:[{offset,active,pct}]}]}` |

**ViewSets** (`reports/viewsets.py`):

| ViewSet | Route prefix | Custom actions |
|---------|-------------|----------------|
| `ReportViewSet` | `/api/v1/reports/` | `execute` (POST/GET), `export` (GET `?format=csv\|xlsx\|pdf\|json`), `duplicate` (POST), `subscribe` (POST/DELETE), `share` (POST), `preview` (POST — applies temp config overrides, executes without persisting) |
| `ReportFolderViewSet` | `/api/v1/report-folders/` | CRUD |
| `ReportExecutionViewSet` | `/api/v1/report-executions/` | list/retrieve + `rerun` (POST) |

### `analytics/` — pre-built dashboards

**Models** (`analytics/models.py`):

| Model | Purpose | Key fields / indexes |
|-------|---------|----------------------|
| `Dashboard` | Named widget collection | `name`, `config` JSON (layout), `is_default`, `created_by`. Index `(tenant,is_default)`. |
| `DashboardWidget` | Tile on a dashboard | `dashboard` FK CASCADE, `title`, `widget_type` (chart/metric/table/funnel), `report` FK SET_NULL (optional), `config` JSON (`{data_source, position, size, ...}`), `order`. Index `(dashboard,order)`. |

**Service layer** (`analytics/services.py`):

* `compute(data_source, tenant=None, **kwargs)` — dispatch to one of the 12 pre-built analytics functions.
* `list_available()` — names of every pre-built dataset.
* `render_dashboard(dashboard_id)` — hydrate every widget: report-backed widgets → `ReportService.execute_report(persist=False)`; `data_source`-backed widgets → matching analytics function.

**ViewSets** (`analytics/viewsets.py`):

| ViewSet | Route prefix | Custom actions |
|---------|-------------|----------------|
| `DashboardViewSet` | `/api/v1/dashboards/` | `add_widget` (POST), `remove_widget` (POST), `render` (GET — hydrate every widget), `available` (GET — list pre-built datasets), `compute` (GET `?data_source=...&group_by=...`) |
| `DashboardWidgetViewSet` | `/api/v1/dashboard-widgets/` | CRUD |

### Celery beat schedule (Phase 15 additions)

| Task name        | Task                           | Schedule         |
|------------------|--------------------------------|------------------|
| `reports-run-scheduled` | `reports.run_scheduled_reports` | every 1 minute |

### Permissions

Writes on both apps are gated by `HasPermission("reports.manage")` /
`HasPermission("analytics.manage")`. Read access (list / retrieve /
execute / export / preview / render / compute / available) requires
only `IsAuthenticated` + `IsTenantMember`.

### Phase 15 status

Production-grade source artifacts. The Django app cannot run in this
sandbox (only Next.js on port 3000), so the artifacts are validated
for syntactic correctness and architectural soundness only. The first
real migrations for the Phase 15 additions must be generated in a real
environment (`python manage.py makemigrations reports analytics`).

The report builder's source-model registry (`_source_models` in
`reports/services.py`) maps 8 source keys (`lead`/`contact`/`account`/
`deal`/`task`/`event`/`call`/`activity`) to Django model paths; the
mapping is resolved lazily so the module is import-safe in test
contexts that haven't migrated every CRM app. The pre-built analytics
functions all rely on the thread-local tenant set by
`api.middleware.TenantMiddleware` (or `api.managers.tenant_context`
in Celery workers / tests). `sales_cycle_length` is computed in Python
rather than via ORM date-difference aggregates so the function is
portable across SQLite / Postgres without needing a database-specific
duration-expression helper.

---

# Phase 16 — Dashboards, Forecasting & Goals

Phase 16 ships three tenant-scoped apps on top of the Phase-15 reports +
analytics layer:

- **`dashboards/`** — dashboard builder with 9 widget types, GridStack
  positions, refresh interval, sharing, default flag, and 5 pre-built
  templates (Sales Manager / Sales Rep / Marketing / Customer Success /
  Executive). Replaces the Phase-15 `analytics` dashboard router — the
  new app's `dashboards/` URL prefix is registered BEFORE
  `analytics.urls` in `config/urls.py` so the new endpoints take
  precedence over the legacy Phase-15 ones.
- **`forecasting/`** — rep + manager forecasting with 5 forecast
  categories (pipeline / best_case / commit / closed / omitted), 4
  period types (weekly / monthly / quarterly / yearly), auto-calc from
  open deals via the Phase-8 pipeline's `Deal.forecast_category`, manual
  overrides with append-only audit trail, submit/approve workflow, team
  roll-up, accuracy tracking (predicted vs actual), and best / worst /
  most-likely scenarios.
- **`goals/`** — user / team / org-scoped goals on 7 metrics (revenue /
  deals_closed / calls_made / emails_sent / meetings_held /
  leads_created / custom) over 5 periods (daily / weekly / monthly /
  quarterly / yearly). `actual_amount` is auto-refreshed by a daily
  1am Celery beat task. Also ships a leaderboard endpoint and 4
  gamification achievement badges (first_deal / 100k_deals /
  100_calls_week / top_performer_month).

All three apps follow the established Phase-15 pattern:
`TenantModel` + `TimestampedModel` + `TenantManager` base,
`CRMCursorPagination`, `IsTenantMember + HasPermission("...manage")`
gating, `DefaultRouter` mounted under `/api/v1/`, shared
`api.factories._current_tenant` / `_current_user`, and lazy model
imports inside service functions so `forecasting.services` / `goals.services`
never import `deals` / `leads` / `calls` / `events` /
`email_integration` at module load (test isolation stays cheap).

### Files added (Phase 16)

```
backend/dashboards/{__init__,apps,models,services,serializers,
viewsets,urls,filters,factories}.py
backend/dashboards/migrations/__init__.py
backend/dashboards/tests/{__init__,test_models,test_services}.py
backend/forecasting/{__init__,apps,models,services,serializers,
viewsets,urls,filters,factories}.py
backend/forecasting/migrations/__init__.py
backend/forecasting/tests/{__init__,test_models,test_services}.py
backend/goals/{__init__,apps,models,services,serializers,viewsets,urls,
filters,factories,tasks}.py
backend/goals/migrations/__init__.py
backend/goals/tests/{__init__,test_models,test_services}.py
```

### Settings + URL wiring

`config/settings.py`:
- `INSTALLED_APPS` — added `dashboards`, `forecasting`, `goals` after
  `analytics` (Phase 15) with a Phase-16 comment block.
- `SPECTACULAR_SETTINGS.TAGS` — added 3 tag descriptions (dashboards /
  forecasting / goals).
- `CELERY_BEAT_SCHEDULE` — added `goals-refresh-all` entry
  (`crontab(hour=1, minute=0)` daily, dispatches
  `goals.refresh_all_goals`).

`config/urls.py` — included `dashboards.urls`, `forecasting.urls`,
`goals.urls` at `/api/v1/` BEFORE `analytics.urls` (so the new
`dashboards/` endpoints supersede the Phase-15 analytics dashboard
router).

### Endpoints exposed

```
/api/v1/dashboards/                         (+ /render/ /templates/ /add_widget/ /export_pdf/ on detail)
/api/v1/dashboard-widgets/
/api/v1/forecasts/                          (+ /calculate/ /submit/ /approve/ /override/ on detail; +/roll_up/ /accuracy/ /scenarios/ on list)
/api/v1/forecast-adjustments/
/api/v1/goals/                              (+ /refresh/ /refresh_all/ /progress/ /leaderboard/)
/api/v1/goal-achievements/                  (+ /my_badges/ /check/)
```

### Models

- **`dashboards.Dashboard`** — `tenant`, `name`, `layout` (GridStack
  JSON), `filters` (global date-range / owner / team), `refresh_interval`
  (sec, default 300), `shared_with` (JSON list of user ids),
  `is_default`, `created_by` FK User. Indexes: `(tenant, is_default)`,
  `(tenant, created_by)`.
- **`dashboards.DashboardWidget`** — `tenant`, `dashboard` FK (CASCADE),
  `widget_type` (kpi / chart / table / gauge / leaderboard / funnel /
  progress / counter / iframe), `title`, `report` FK nullable (SET_NULL),
  `position` JSON `{x,y,w,h}`, `color_theme`, `drill_down` JSON
  nullable, `custom_config` JSON, `order`. Index: `(dashboard, order)`.
- **`forecasting.Forecast`** — `tenant`, `user` FK, `period_type`
  (weekly / monthly / quarterly / yearly), `period_start` /
  `period_end`, `category` (pipeline / best_case / commit / closed /
  omitted), `amount` (auto-calc from deals), `override_amount`
  (nullable), `notes`, `submitted_at`, `approved_by` FK User nullable,
  `approved_at`. Indexes: `(tenant, user, period_type, period_start)`,
  `(tenant, period_start)`.
- **`forecasting.ForecastAdjustment`** — `tenant`, `forecast` FK
  (CASCADE), `adjusted_by` FK User, `old_amount`, `new_amount`,
  `reason`. Index: `(forecast, created_at)`.
- **`goals.Goal`** — `tenant`, `owner_type` (user / team / org),
  `owner_id`, `metric` (revenue / deals_closed / calls_made /
  emails_sent / meetings_held / leads_created / custom), `period_type`
  (daily / weekly / monthly / quarterly / yearly), `period_start` /
  `period_end`, `target_amount`, `actual_amount`, `is_active`,
  `parent_goal` self-nullable (CASCADE). Indexes: `(tenant, owner_type,
  owner_id, period_start)`, `(tenant, metric, period_type)`.
- **`goals.GoalAchievement`** — `tenant`, `user` FK, `badge_type`
  (first_deal / 100k_deals / 100_calls_week / top_performer_month),
  `awarded_at`. Index: `(tenant, user)`. Unique: `(tenant, user,
  badge_type)`.

### Services

- **`dashboards.services.render_dashboard(dashboard)`** — evaluates
  every widget (report-bound widgets execute via
  `reports.services.report_service`; data_source widgets dispatch via
  `analytics.services.compute`; static widgets pass config through).
- **`dashboards.services.get_templates()`** — returns the 5 pre-built
  dashboard templates as deep-copy JSON blobs.
- **`forecasting.services.calculate_forecast(user, period_type,
  period_start, category, tenant)`** — sums `Deal.amount` for the
  user's deals whose `forecast_category` matches the requested bucket
  AND whose `close_date` falls inside the period. For the `commit`
  bucket, additionally includes `best_case` deals with `probability >=
  75`.
- **`forecasting.services.get_or_create_forecast(...)`** — idempotent
  upsert + recalc.
- **`forecasting.services.submit_forecast(forecast)`** /
  **`approve_forecast(forecast, approver)`** /
  **`apply_override(forecast, new_amount, adjusted_by, reason)`** —
  lifecycle + audit.
- **`forecasting.services.roll_up(manager, period_type, period_start,
  tenant)`** — aggregates the manager's direct reports' forecasts.
- **`forecasting.services.get_accuracy(user, periods_back=3)`** —
  predicted (commit) vs actual (closed) for the last N months.
- **`forecasting.services.get_scenarios(user, period_type,
  period_start, tenant)`** — best / worst / most-likely (best = sum of
  all amounts; worst = sum of `probability >= 75`; most_likely =
  sum of `amount * probability / 100`).
- **`goals.services.calculate_actual(goal)`** — queries CRM data for
  the goal's (metric, period, owner) and returns the actual amount.
  Each metric block picks the right owner field per model (Deal / Lead
  → `owner`; Call → `created_by`; Event → `organizer`; Email →
  `account.user`).
- **`goals.services.refresh_all_goals(tenant=None)`** —
  recalculate `actual_amount` on every active `Goal`. Returns
  `{refreshed, errors}`.
- **`goals.services.get_leaderboard(metric, period_type, ref, tenant,
  limit)`** — rank users by `actual_amount`.
- **`goals.services.check_achievements(user, tenant)`** — award the 4
  gamification badges; returns the list of newly-awarded badge types.
- **`goals.services.get_goal_progress(user, metric, period_type, ref,
  tenant)`** — returns `{target, actual, percentage, status}` where
  status ∈ `behind` / `on_track` / `exceeded`.

### Celery beat

`goals-refresh-all` (daily 1am) dispatches `goals.refresh_all_goals`
which iterates every active `Goal` and writes the freshly-calculated
`actual_amount` back to the row.

### Tests

- `dashboards/tests/test_models.py` — 4 tests (defaults+str, widget
  defaults+str, cascade-delete, layout JSON round-trip).
- `dashboards/tests/test_services.py` — 5 tests (5 templates, deep
  copy, empty dashboard, static widget pass-through, widget order).
- `forecasting/tests/test_models.py` — 4 tests (defaults+str,
  effective_amount override, adjustment str, cascade delete).
- `forecasting/tests/test_services.py` — 5 tests (period_bounds
  monthly + quarterly, calculate_forecast sums matching deals,
  submit+approve timestamps, get_scenarios best/worst/most_likely,
  get_accuracy empty).
- `goals/tests/test_models.py` — 4 tests (defaults+str, parent_goal
  self-ref, cascade delete, achievement unique per user+badge).
- `goals/tests/test_services.py` — 6 tests (period_bounds monthly,
  calculate_actual revenue, refresh_all_goals, get_goal_progress
  status, get_goal_progress not found, get_leaderboard sorted).

Total: 28 new tests.

### Migrations

Like Phase 15, the migration files are intentionally just
`__init__.py` placeholders. The first real migration must be generated
in a real environment:

```
python manage.py makemigrations dashboards forecasting goals
python manage.py migrate
```

## What's in Phase 17

Phase 17 builds the **platform customization layer** — seven
tenant-scoped apps that let admins extend the CRM without code:

- **`custom_modules/`** — Salesforce-Custom-Object-equivalent. Define
  new record types ("Properties", "Vehicles", "Projects") with a
  schema of typed fields (`text` / `number` / `email` / `phone` /
  `date` / `datetime` / `picklist` / `multipicklist` / `boolean` /
  `currency` / `url` / `textarea` / `lookup` / `auto_number`).
  Records are stored in a generic `JSONField` keyed by field
  `api_name`; validation (required / type / picklist / lookup) lives
  in the service layer. `POST /api/v1/custom-modules/{id}/clone/`
  deep-copies a module + its field schema (records excluded).
- **`layouts/`** — Salesforce-Layout-equivalent. Page layouts for a
  `(module, profile?)` tuple with sections (columns + collapsible +
  ordered field list). `GET /api/v1/layouts/{id}/fields/` returns the
  flattened ordered field list.
- **`profiles/`** — Salesforce-Profile-equivalent. A profile bundles
  per-module CRUD + export + share flags and field-level access
  (`hidden` / `visible` / `read_only` / `editable`).
  `GET /api/v1/profiles/{id}/permission_matrix/` returns the
  flattened per-module matrix.
- **`territories/`** — Salesforce-Territory-equivalent. Territories
  have rules (JSON: module + filters + strategy) + members +
  manager. `POST /api/v1/territories/{id}/realign/` re-evaluates the
  rules and re-assigns matching records to members via
  `round_robin` / `load_balance` / `all_to_manager`.
- **`canvas/`** — singleton-per-tenant white-label theme (colors /
  font / density / sidebar style / logo / custom CSS).
  `GET /api/v1/canvas-themes/templates/` lists 5 pre-built themes
  (Ocean / Forest / Sunset / Slate / Candy).
  `POST /api/v1/canvas-themes/preview/` returns merged values + a
  computed CSS string for sandboxed preview.
- **`sandbox/`** — Salesforce-Sandbox-equivalent. Capture a tenant's
  customisation snapshot (custom_modules + layouts + profiles +
  territories + canvas + template_builder) into a branch, compare
  against another, and push to production.
  `POST /api/v1/sandboxes/create_snapshot/` captures;
  `POST /api/v1/sandboxes/{id}/compare/` diffs;
  `POST /api/v1/sandboxes/{id}/push_to_production/` merges.
- **`template_builder/`** — email + PDF templates with
  `POST /preview/` (built-in sample data per category) and
  `POST /render/` (caller-supplied data → rendered HTML via the
  Django template engine). PDF categories: `quote` / `invoice` /
  `contract` / `proposal`.

### API surface

```
/api/v1/custom-modules/                  (+ /clone/ on detail)
/api/v1/custom-module-fields/
/api/v1/custom-module-records/           (validates data vs. field schema)
/api/v1/layouts/                         (+ /fields/ on detail)
/api/v1/layout-sections/
/api/v1/profiles/                        (+ /permission_matrix/ on detail)
/api/v1/profile-permissions/
/api/v1/field-permissions/
/api/v1/territories/                     (+ /members/ + /realign/ on detail)
/api/v1/territory-members/
/api/v1/canvas-themes/                   (singleton: list/retrieve/update/patch + /templates/ + /preview/)
/api/v1/sandboxes/                       (+ /create_snapshot/ on list; + /compare/ + /push_to_production/ on detail)
/api/v1/email-templates/                 (+ /preview/ + /render/ on detail)
/api/v1/pdf-templates/                   (+ /preview/ + /render/ on detail)
```

### Patterns

- All 7 models inherit `TenantModel` (auto-scoped by `TenantManager`
  via thread-local) + `TimestampedModel` (created_at / updated_at).
- Write paths gated by `HasPermission("<app>.manage")` + `IsTenantMember`;
  reads need only `IsAuthenticated + IsTenantMember`.
- `CRMCursorPagination` on list endpoints; `DefaultRouter` per app.
- Service functions use lazy model imports inside the function body
  (e.g. `sandbox.services.create_snapshot` imports
  `custom_modules` / `layouts` / `profiles` / `territories` /
  `canvas` / `template_builder` inside the function) so module load
  stays cheap and test isolation is preserved.
- `CanvasTheme` enforces singleton-per-tenant via
  `unique_together = (("tenant",),)`; first access auto-creates via
  `get_theme_for_tenant`.

### Migrations

Like Phase 15/16, the migration files are intentionally just
`__init__.py` placeholders. The first real migration must be generated
in a real environment:

```
python manage.py makemigrations custom_modules layouts profiles territories canvas sandbox template_builder
python manage.py migrate
```

### Tests

2-3 tests per file (model + service), 14 test files total, ~32 test
functions. Fixtures from `conftest.py` (`active_tenant`, `user`,
`api_client`) reused; `factory_boy` factories per app.

## Phase 18 — AI layer (ai_core + 9 AI apps)

Phase 18 builds the **AI layer** — a central LLM orchestrator and nine
tenant-scoped AI apps that consume it. Every LLM invocation goes
through `ai_core.services.call_llm`, which logs token usage + cost to
`AICostLog` and enforces the tenant's monthly budget via
`check_budget`. All ten apps are minimal but complete (models +
serializers + viewsets + urls + services + tests + apps.py +
`__init__.py` + empty migrations placeholder); the stub
`call_llm` body returns a deterministic echo so the apps are fully
testable today — production swaps in the real OpenAI / Anthropic /
Gemini SDK behind the same surface.

- **`ai_core/`** — central orchestrator. `AICostLog` (tenant FK +
  model + input_tokens + output_tokens + cost + task_type +
  created_at; indexes `(tenant, -created_at)` + `(tenant, task_type,
  -created_at)`). `PromptTemplate` (tenant FK + name + version +
  system_prompt + user_prompt_template + is_active; unique `(tenant,
  name, version)`; indexes `(tenant, is_active, name)`). Services:
  `call_llm(messages, model='gpt-4o-mini', temperature=0.7,
  max_tokens=1000)` → logs cost + returns `{content, model,
  input_tokens, output_tokens, cost, task_type}`; `stream_llm()` →
  generator yielding chunked responses; `check_budget(tenant)` →
  `{spent, budget, remaining, period_start, period_end}` for the
  current calendar month; `get_active_template(name)` /
  `activate_template(template)` (atomic flip of `is_active`).
  Viewsets: `AICostLogViewSet` (read-only + `@action budget`),
  `PromptTemplateViewSet` (CRUD + `@action activate` + `@action
  active`).
- **`lead_scoring/`** — `LeadScore` (tenant FK + lead_id + score 0-100
  + factors JSON + model_version + calculated_at; unique `(tenant,
  lead_id)`; indexes `(tenant, lead_id)` + `(tenant, -score)`).
  Services: `score_lead(lead_id)` (heuristic: +5 email, +5 phone,
  +20 company, +0/+15/+30 revenue tier, +0/+10/+15/+20 source weight;
  capped at 100), `score_all_leads()` (Celery beat daily 2am),
  `get_hot_leads(tenant)` (score > 80). Viewset:
  `LeadScoreViewSet` (`@action score_lead`, `@action hot_leads`).
- **`deal_prediction/`** — `PredictedDealValue` (tenant FK + deal_id +
  expected_value + close_probability + expected_close_date +
  factors JSON + model_version + calculated_at; unique `(tenant,
  deal_id)`; indexes `(tenant, deal_id)` + `(tenant,
  close_probability)`). Services: `predict_deal(deal_id)`
  (heuristic: `close_probability = stage.probability`,
  `expected_value = amount * probability`, prior stashed in
  `factors.previous_probability`), `predict_all_deals()` (Celery beat
  daily 2:30am), `get_at_risk(tenant)` (relative probability drop >
  20% week-over-week). Viewset: `PredictedDealValueViewSet`
  (`@action predict`, `@action at_risk`).
- **`anomaly_detection/`** — `Anomaly` (tenant FK + record_type +
  record_id + anomaly_type + severity low/medium/high/critical +
  description + acknowledged_by User FK nullable + acknowledged_at +
  status open/acknowledged/resolved + detected_at; indexes `(tenant,
  status)` + `(tenant, -detected_at)` + `(tenant, severity,
  -detected_at)`). Services: `scan_anomalies()` (Celery beat hourly;
  scans deal-amount drops via deal_prediction, rep-activity drops via
  calls, lead-response-time breaches via leads; high/critical fire
  notifications via the notifications app), `acknowledge_anomaly(anomaly,
  user)`, `resolve_anomaly(anomaly)`, `get_trends(tenant, days=30)`.
  Viewset: `AnomalyViewSet` (CRUD + `@action acknowledge` + `@action
  resolve` + `@action trends` + `@action scan`).
- **`sentiment_analysis/`** — `Sentiment` (tenant FK + record_module +
  record_id + sentiment float in [-1, +1] + confidence float in
  [0, 1] + model_version + analyzed_at; indexes `(tenant,
  record_module, record_id)` + `(tenant, -analyzed_at)`). Services:
  `analyze_text(text)` (heuristic positive/negative word lexicons;
  `sentiment = (pos - neg) / total`, `confidence = min(1, total /
  10)`), `analyze_record(module, record_id, text?)`, `get_trend(module,
  record_id, limit=30)` (oldest-first), `get_heatmap(tenant, days=30)`
  (`{module: avg_sentiment}`). Viewset: `SentimentViewSet`
  (`@action analyze`, `@action trend`, `@action heatmap`).
- **`smart_suggestions/`** — `SmartSuggestion` (tenant FK + user FK +
  suggestion_type next_best_action/cross_sell/upsell/churn_risk/win_loss_predictor
  + title + description + target_module + target_id + priority +
  is_dismissed + is_accepted; indexes `(tenant, user, is_dismissed)`
  + `(tenant, user, suggestion_type)`). Services:
  `generate_suggestions(user)` (scans for stale leads not contacted
  in 7 days, deals stuck in stage 14+ days, accounts with no activity
  in 60 days; de-duped by `(tenant, user, target_module, target_id,
  suggestion_type)`), `accept_suggestion(id)`, `dismiss_suggestion(id)`.
  Viewset: `SmartSuggestionViewSet` (`@action generate`, `@action
  accept`, `@action dismiss`).
- **`nlp_queries/`** — `NLPQuery` (tenant FK + user FK + question +
  generated_spec JSON + result_summary; indexes `(tenant, user,
  -created_at)`). Services: `parse_query(question)` (keyword matching:
  "deals closing this month" → `{model: "deal", filters: {close_date:
  "this_month"}}`; "open leads" → `{model: "lead", filters: {status:
  "open"}}`; "won deals" → `{model: "deal", filters:
  {"stage.is_won_stage": True}}`), `execute_query(spec)` (lazy-imports
  the target CRM model + applies filters + returns `{count, sample,
  summary}`), `save_as_report(query_id)` (promotes the query to a
  `reports.Report` row). Viewset: `NLPQueryViewSet` (`@action ask`,
  `@action save_as_report`).
- **`zia_chatbot/`** — `ZiaConversation` (tenant FK + user FK +
  messages JSON list of `{role, content, timestamp, tool_calls?}`;
  unique `(tenant, user)`; indexes `(tenant, user, -updated_at)`).
  Services: `chat(user, message)` (appends user message → builds
  LLM payload [system prompt + last 20 turns + new message] → calls
  `ai_core.call_llm` → appends assistant response → returns
  `{content, tool_calls, conversation_id}`), `get_history(user)`,
  `clear_history(user)`. Viewset: `ZiaConversationViewSet`
  (`@action send_message`, `@action history`, `@action clear`).
- **`ai_writer/`** — `AIWriterDraft` (tenant FK + user FK + draft_type
  email/blog/social/summary/proposal + prompt + generated_content +
  style + tone; indexes `(tenant, user, -created_at)` + `(tenant,
  draft_type, -created_at)`). Services: `generate_email(prompt,
  style='professional', tone='friendly')`, `generate_summary(text)`
  (3-5 bullet points), `generate_subject_lines(email_body)` (3-5
  candidates). All three call `ai_core.call_llm` with `task_type=
  email_draft`. Viewset: `AIWriterDraftViewSet` (CRUD + `@action
  generate_email` + `@action generate_summary` + `@action
  generate_subjects`).
- **`ai_agents/`** — `AIAgentRun` (tenant FK + agent_type
  lead_research/deal_coach/email_triage/data_hygiene/customer_success +
  target_module + target_id + status running/completed/failed + result
  JSON + started_at + completed_at; indexes `(tenant, agent_type,
  -started_at)` + `(tenant, status)`). Services: `run_agent(agent_type,
  target_module, target_id, tenant)` (creates row → runs stub agent
  impl → marks completed/failed), `run_lead_research(lead_id)`,
  `run_deal_coach(deal_id)`, `run_email_triage(email_id)`,
  `run_data_hygiene(module)`, `run_customer_success(account_id)`.
  Celery tasks: one per agent type + `run_pending_sweep_task` (5min
  beat). Viewset: `AIAgentRunViewSet` (read-only + `@action trigger`
  + `@action results`).

### API surface

```
/api/v1/ai-cost-logs/                    (read-only + /budget/)
/api/v1/prompt-templates/                (+ /activate/ + /active/)
/api/v1/lead-scores/                     (+ /score_lead/ + /hot_leads/)
/api/v1/predicted-deal-values/           (+ /predict/ + /at_risk/)
/api/v1/anomalies/                       (+ /acknowledge/ + /resolve/ + /trends/ + /scan/)
/api/v1/sentiments/                      (+ /analyze/ + /trend/{id}/ + /heatmap/)
/api/v1/smart-suggestions/               (+ /generate/ + /accept/{id}/ + /dismiss/{id}/)
/api/v1/nlp-queries/                     (+ /ask/ + /save_as_report/{id}/)
/api/v1/zia-conversations/               (+ /send_message/ + /history/ + /clear/)
/api/v1/ai-writer-drafts/                (+ /generate_email/ + /generate_summary/ + /generate_subjects/)
/api/v1/ai-agent-runs/                   (read-only + /trigger/ + /results/{id}/)
```

### Celery beat (Phase 18)

Four new beat entries (in addition to the existing Phase 7-17 entries):

```
anomaly-scan        → anomaly_detection.scan_anomalies        (hourly)
lead-score-all      → lead_scoring.score_all_leads            (daily 02:00 UTC)
deal-predict-all    → deal_prediction.predict_all_deals       (daily 02:30 UTC)
ai-agents-run       → ai_agents.run_pending_sweep             (every 5 min)
```

The per-lead / per-deal / per-email AI-agent runs are dispatched
on-demand by CRM signals (post_save on Lead → `run_lead_research`,
post_save on Deal → `run_deal_coach`, inbound Email →
`run_email_triage`) — not by beat.

### Patterns

- All 11 models inherit `TenantModel` (auto-scoped by `TenantManager`
  via thread-local) + `TimestampedModel` (created_at / updated_at).
  `AIAgentRun` / `Anomaly` / `AICostLog` add explicit `detected_at` /
  `started_at` / `created_at` DateTimeFields for index-on-time.
- Write paths gated by `HasPermission("<app>.manage")` +
  `IsTenantMember`; reads need only `IsAuthenticated + IsTenantMember`.
  `ZiaConversation` / `SmartSuggestion` / `NLPQuery` are caller-
  scoped on `list` (filter `user=request.user`) so each user only
  sees their own data.
- `CRMCursorPagination` on list endpoints; `DefaultRouter` per app.
- Every LLM call goes through `ai_core.services.call_llm`, which
  writes one `AICostLog` row per call and aggregates via
  `check_budget` for the tenant's monthly spend. Stub body returns a
  deterministic echo — production swaps in the real OpenAI / Anthropic
  / Gemini SDK behind the same surface.
- Service functions use lazy model imports inside the function body
  (e.g. `anomaly_detection.services.scan_anomalies` imports
  `deal_prediction` / `calls` / `leads` inside the function) so
  module load stays cheap and test isolation is preserved.

### Migrations

Like Phase 15/16/17, the migration files are intentionally just
`__init__.py` placeholders. The first real migration must be
generated in a real environment:

```
python manage.py makemigrations ai_core lead_scoring deal_prediction \
    anomaly_detection sentiment_analysis smart_suggestions nlp_queries \
    zia_chatbot ai_writer ai_agents
python manage.py migrate
```

### Tests

1-2 tests per file (model + service), 20 test files total, ~40 test
functions across the 10 apps. Fixtures from `conftest.py`
(`active_tenant`, `user`, `api_client`) reused. `pytest.mark.django_db`
on every test file. Lazy imports inside services keep test isolation
cheap.

## Phase 19 — Ecosystem apps (marketplace + invoicing + support + projects + marketing + hr + native_integrations)

Phase 19 adds seven tenant-scoped business apps that round out the CRM
into a full SaaS platform. Each app ships a minimal but complete Django
app skeleton (models + serializers + viewsets + urls + apps.py + tests
+ empty migrations placeholder).

### Apps + models

| App | Models | Notes |
|-----|--------|-------|
| `marketplace/` | `Extension`, `InstalledExtension` | `Extension.tenant` is nullable so the catalog row is global; `InstalledExtension` is the per-tenant install record (unique `(tenant, extension)`). |
| `invoicing/` | `Invoice`, `Estimate`, `Payment` | Invoice + Estimate share an identical shape but carry distinct status choice sets; Payment is FK-linked to Invoice. |
| `support/` | `Ticket`, `TicketReply`, `KnowledgeBaseArticle` | Tickets have priority + SLA deadline; replies can be marked `is_internal`. |
| `projects/` | `Project`, `ProjectTask`, `TimeEntry` | Tasks carry estimated/actual hour counters; TimeEntry is billable-flagged. |
| `marketing/` | `Campaign`, `SubscriberList`, `MarketingEmail` | Campaign type ∈ email/social/sms; metrics JSON; MarketingEmail has sent/open/click counters. |
| `hr/` | `Employee`, `LeaveRequest`, `ExpenseClaim` | Employee ↔ User FK optional; leave + expense have pending/approved/rejected lifecycle. |
| `native_integrations/` | `Integration`, `IntegrationLog` | 13 providers (google_workspace / microsoft_365 / slack / zoom / mailchimp / quickbooks / stripe / razorpay / docusign / clearbit / hunter / calendly / zapier); unique `(tenant, provider)`; append-only log per integration. |

### HTTP surface (all under `/api/v1/`)

| Method | Path | Description |
|--------|------|-------------|
| GET / POST | `/extensions/` | List / create catalog rows (`marketplace.manage` for writes) |
| GET | `/extensions/{id}/` | Retrieve |
| POST | `/extensions/{id}/install/` | Install for caller's tenant (creates `InstalledExtension`, bumps downloads counter) |
| POST | `/extensions/{id}/uninstall/` | Remove the caller's `InstalledExtension` |
| GET / POST / PATCH / DELETE | `/installed-extensions/` | CRUD on the tenant's installs |
| GET / POST / PATCH / DELETE | `/invoices/` | CRUD |
| POST | `/invoices/{id}/send/` | Flip status → `sent` |
| POST | `/invoices/{id}/mark_paid/` | Flip → `paid` + optionally create a `Payment` row |
| GET / POST / PATCH / DELETE | `/estimates/` | CRUD |
| GET / POST / PATCH / DELETE | `/payments/` | CRUD |
| GET / POST / PATCH / DELETE | `/tickets/` | CRUD |
| POST | `/tickets/{id}/reply/` | Append a `TicketReply` (`body`, `is_internal?`) |
| POST | `/tickets/{id}/resolve/` | Flip status → `resolved` |
| POST | `/tickets/{id}/close/` | Flip status → `closed` |
| GET / POST / PATCH / DELETE | `/ticket-replies/` | CRUD |
| GET / POST / PATCH / DELETE | `/kb-articles/` | CRUD on knowledge-base articles |
| GET / POST / PATCH / DELETE | `/projects/` | CRUD |
| GET / POST / PATCH / DELETE | `/project-tasks/` | CRUD |
| GET / POST / PATCH / DELETE | `/time-entries/` | CRUD |
| GET / POST / PATCH / DELETE | `/campaigns/` | CRUD |
| POST | `/campaigns/{id}/send/` | Flip status → `running` (enqueue send in production) |
| GET / POST / PATCH / DELETE | `/subscriber-lists/` | CRUD |
| GET / POST / PATCH / DELETE | `/marketing-emails/` | CRUD |
| GET / POST / PATCH / DELETE | `/employees/` | CRUD |
| GET / POST / PATCH / DELETE | `/leave-requests/` | CRUD |
| POST | `/leave-requests/{id}/approve/` | Flip status → `approved` |
| POST | `/leave-requests/{id}/reject/` | Flip status → `rejected` |
| GET / POST / PATCH / DELETE | `/expense-claims/` | CRUD |
| POST | `/expense-claims/{id}/approve/` | Flip status → `approved` |
| POST | `/expense-claims/{id}/reject/` | Flip status → `rejected` |
| GET / POST / PATCH / DELETE | `/integrations/` | CRUD (unique `(tenant, provider)`) |
| POST | `/integrations/{id}/connect/` | Mark connected + stamp `last_synced_at` + write `IntegrationLog` |
| POST | `/integrations/{id}/disconnect/` | Mark disconnected + write log |
| POST | `/integrations/{id}/sync/` | Stamp `last_synced_at` + write log (rejects if not connected) |
| GET | `/integrations/{id}/logs/` | Append-only event log for the integration |

### Patterns

- 19 new models; 18 use the established `TenantModel` base
  (auto-scoped by `TenantManager` via thread-local) + `TimestampedModel`.
  The one exception is `marketplace.Extension` which inherits
  `TimestampedModel` + a nullable `tenant` FK so the catalog row is
  shared across tenants.
- Write paths gated by `HasPermission("<app>.manage")` +
  `IsTenantMember`; reads need only `IsAuthenticated + IsTenantMember`.
  `perform_create` on every `ModelViewSet` auto-stamps
  `tenant=request.tenant` so callers can't forge cross-tenant rows.
- `CRMCursorPagination` on list endpoints; `DefaultRouter` per app;
  `@action(detail=True, methods=["post"])` for state-flip operations.
- Every choice set is exposed as module-level constants
  (`INV_DRAFT`, `PRJ_ACTIVE`, `PROVIDER_SLACK`, etc.) so callers don't
  hardcode strings.

### Migrations

Like Phase 15-18, the migration files are intentionally just
`__init__.py` placeholders. The first real migration must be generated
in a real environment:

```
python manage.py makemigrations marketplace invoicing support \
    projects marketing hr native_integrations
python manage.py migrate
```

### Tests

1 model-layer test per file (per brief), 7 test files total, 7 test
functions across the 7 apps. Fixtures from `conftest.py`
(`active_tenant`, `user`) reused. `pytest.mark.django_db` on every
test file. The `native_integrations` test additionally asserts the
unique `(tenant, provider)` constraint raises on duplicate insert.


## Phase 20 — Security + Compliance apps

Six new tenant-scoped security + compliance apps (one global-catalog
model exception):

- **`audit/`** — `AuditLog` (tenant FK + `actor_id` + `action` +
  `target_type` + `target_id` + `changes` JSON field-level diff +
  `ip` + `user_agent` + `timestamp`). Indexed on `(tenant, timestamp)`
  and `(tenant, target_type, target_id)`. **Immutable** — `save()`
  raises `PermissionError` if not an insert; `delete()` always raises.
  `AuditLogViewSet` is read-only list / retrieve + `@action per_record`
  (GET `?target_type=&target_id=` filters audit rows for one target).
- **`access_control/`** — `IPAllowlist` (cidr + is_active),
  `SessionPolicy` (timeout_minutes + max_concurrent; `UniqueConstraint`
  on tenant → one policy per tenant), `TrustedDevice` (user FK +
  device_id + last_seen; unique `(tenant, user, device_id)`). Three
  ModelViewSets (full CRUD).
- **`data_security/`** — `DataClassification` (model + field +
  classification `public`/`internal`/`confidential`/`restricted`),
  `RetentionPolicy` (model + retention_days + action
  `archive`/`delete`). Two ModelViewSets (full CRUD).
- **`compliance/`** — `ComplianceFramework` (global catalog: name +
  description + is_active), `ComplianceChecklist` (tenant FK + framework
  FK + item + status `pending`/`met`/`not_applicable` + evidence),
  `DataProcessingConsent` (tenant FK + user FK + consent_type +
  granted_at + withdrawn_at). Three viewsets; `ComplianceChecklistViewSet`
  exposes `@action report` (per-framework roll-up with
  `compliance_pct = met/total*100`).
- **`backup/`** — `BackupRecord` (tenant FK + type
  `full`/`incremental`/`wal` + status `pending`/`running`/`completed`/
  `failed` + size_bytes + s3_key + started_at + completed_at).
  `BackupRecordViewSet` is read-only + `@action restore` (POST stub —
  returns `{status: scheduled, backup_id, s3_key, message}`; real
  restore dispatch would enqueue a Celery task).
- **`security_monitoring/`** — `SecurityEvent` (tenant FK + event_type
  + severity `info`/`low`/`medium`/`high`/`critical` + description + ip
  + metadata JSON), `SecurityAlert` (tenant FK + event FK + status
  `open`/`acknowledged`/`resolved` + acknowledged_by FK User nullable).
  `SecurityEventViewSet` is read-only + `@action acknowledge` (POST
  upserts the linked `SecurityAlert` to `acknowledged` + stamps
  `acknowledged_by=request.user`). `SecurityAlertViewSet` is read-only.

### Celery beat (Phase 20)

| Schedule key | Task | Schedule |
|--------------|------|----------|
| `backup-daily-full` | `backup.run_daily_full` | daily 02:00 UTC |
| `retention-cleanup` | `data_security.run_retention_cleanup` | daily 03:00 UTC |

### Migrations

Like Phase 15-19, the migration files are intentionally just
`__init__.py` placeholders. The first real migration must be generated
in a real environment:

```
python manage.py makemigrations audit access_control data_security \
    compliance backup security_monitoring
python manage.py migrate
```

### Tests

1 model-layer test per file (per brief), 6 test files total, 6 test
functions across the 6 apps. Fixtures from `conftest.py`
(`active_tenant`, `user`) reused. `pytest.mark.django_db` on every test
file. The `audit` test additionally asserts the immutability invariant
(update + delete both raise `PermissionError`). The `access_control`
test additionally asserts the `SessionPolicy` one-per-tenant unique
constraint raises on duplicate insert (wrapped in
`transaction.atomic()` so the test connection isn't poisoned).

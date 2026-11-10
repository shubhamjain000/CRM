# Task 53-a — Work Record

## Files changed (all edits, no new files)

1. **src/components/crm/record-form.tsx** (edit)
2. **src/components/crm/detail-view.tsx** (edit)
3. **src/components/customization/views/module-builder.tsx** (edit)
4. **src/components/crm/call-dialer.tsx** (edit — event payload only)
5. **src/lib/productivity/handler.ts** (edit — call→activity wiring)

No files outside scope touched. worklog.md untouched (orchestrator writes it).

## Per-fix summary

### FIX 1 — Email field overflow
- record-form.tsx: `renderInput()` common className now appends `overflow-hidden [text-overflow:ellipsis] focus:[text-overflow:clip]` when `inputType === 'email'` (combined with the destructive-error class). Custom-field `renderCustomField` default case gets the same classes when `def.fieldType === 'email'`.
- detail-view.tsx Record-details grid: each field cell wrapper got `min-w-0`, the read-only value div got `min-w-0 truncate` + `title={fullValue}` (hover tooltip), inline-edit Input gets `type="email"` + same overflow/ellipsis classes for email keys (label `p` also truncates for safety).
- crm-table.tsx / virtual-list.tsx: verified only — email/name cells already use `min-w-0 flex-1 truncate` / `truncate`; no changes needed.

### FIX 5 — Module builder overflow
- Field rows `<li>`: `flex flex-wrap items-center gap-2`; type Badge now `min-w-0 max-w-[9rem] shrink-0 truncate` wrapped in Tooltip (full type label); condition badges (required/unique/read-only/dependent) + icon-button container `shrink-0`; label keeps `min-w-0 flex-1 truncate` (+ title). Lookup target span (see FIX 6) wraps to its own line on mobile via `w-full … sm:w-auto sm:max-w-[12rem]`.
- "Add field" row: SelectTrigger `h-8 w-full min-w-0 sm:w-44`, `SelectValue className="truncate"`, Tooltip showing full selected type label; label Input got `min-w-0`.
- FieldSettingsDialog: Type select gets `w-full min-w-0` + truncate + tooltip; Choices inputs `min-w-0 flex-1`; formula input `min-w-0`; dialog grid (`grid gap-3 sm:grid-cols-2`) verified to stack on mobile.
- RelationsCard rows: `min-w-0 flex-wrap`, name span + module Badge truncate with `max-w-[10rem]`, apiName span `min-w-0 truncate`.

### FIX 6 — Lookup (related link) type display
- New `ModuleLookupCombobox` (Popover + Command): trigger styled like other selects (selected module name, truncate + tooltip), `CommandInput` search, `CommandList max-h-64 overflow-y-auto`, `CommandEmpty "No module found"`, None option + check on selected; still writes `fieldOptions.lookupModuleId` via the same `save()` payload.
- Field row shows `→ {moduleName}` (resolved from `allModules` via `moduleById` map) with `min-w-0 truncate` + title tooltip; wraps below the label on mobile, inline on desktop.

### FIX 7 — Quick Create
- Removed silent `quickAdd()` ('New Record' with only defaults). RecordsCard now has a `quickOpen` state; the "Quick create" button (same Zap icon/label) opens a real `QuickCreateDialog` (max-w via default `sm:max-w-lg`, `flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0`, scrollable body, border-t footer always visible).
- Extracted shared plumbing used by both RecordDialog and QuickCreateDialog: `str`, `seedRecordData` (defaults/edit seeding), `validateRecordFields` (required fields, skips dependency-hidden/read-only/formula/autonumber), `buildRecordData`, `sectionedFields`, `renderModuleFieldInput` (the full per-type renderer), and `useModuleFormRemote` hook (members + lookup/child-module records + file upload plumbing). RecordDialog's giant inline switch was replaced by the shared renderer — zero behavior change there (same JSX/classes).
- Submit: identical validation, inline per-field red errors, server `field`→inline error mapping, spinner+disabled while saving, toast on failure/success, `await onSaved()` refreshes the records list without reload, dialog closes on success.

### FIX 14 — Activity auto-update on call
- productivity/handler.ts `createProd` for 'call': after create + audit, `afterCallCreated()` logs `logActivity({module, recordId, action:'called', description, metadata})` with metadata `{callId, callType, outcome, durationSec, startedAt, endedAt}`. Description: `no_answer|busy|voicemail` outcome or `callType==='missed'` → "Missed call — no answer"; connected → "Call completed · <human duration> · <outcome label>" (uses `formatDurationLabel` from client-safe lib/call-tracking).
- Owner notification: related record's `ownerId` is read via a tolerant loose-reference full-row query (`relatedRecordInfo`, follows the `db[m] as any`-style pattern, never throws); when owner ≠ acting user → `createNotification` (dynamic import to avoid the module cycle with realtime/handler) with verb 'call', targetModule/targetId/targetName, data.message "Call completed with <recordName>".
- Realtime: `pushRealtime(user:<actingUser>, 'call.logged', {call, relatedModule, relatedId, recordName})` — 'call.logged' is whitelisted in mini-services/realtime.
- `updateProd` for 'call': when duration/outcome/endedAt/notes change and the row has relatedModule/Id → re-reads the call, recomputes description (merges notes as " — notes" when provided) + metadata, finds the most recent `called` Activity whose metadata JSON contains the callId (safely parsed) and updates it; creates one if none found; pushes realtime too.
- detail-view.tsx: debounced (500ms) `loadTimeline` re-triggered by (a) window `CALL_LOGGED_EVENT` ('unstop:call-logged', matching detail.relatedModule/relatedId; events without detail still refresh) and (b) realtime `call.logged` notifications via `useRealtime()` (dedup by notification id, module+recordId match).
- call-dialer.tsx: `CALL_LOGGED_EVENT` dispatches now include `detail: { relatedModule, relatedId }` for outbound autoLog (from pending) and inbound saveInbound (from selected caller). Transfer dispatch left detail-less (no module context there) — detail-view treats it as a generic refresh, same as before.

## Verification
- `bun run lint`: **0 errors**; 1 pre-existing warning (virtual-list.tsx:89 TanStack Virtual "incompatible library" react-hooks note — untouched file, pre-existing).
- `bunx tsc --noEmit`: **0 errors in src/**. 3 pre-existing errors outside app scope: examples/websocket/server.ts (missing socket.io types), skills/image-edit/scripts/image-edit.ts (sdk body key), src/__tests__/auth.test.ts (bun:test types). Not introduced by me, not fixed (out of scope).
- dev.log: HMR rebuilds all "✓ Compiled", no compile/runtime errors after edits (only pre-existing `[jobs] gmail poll` errors unrelated to scope).

## Skipped / notes
- FIX 1 also added `min-w-0` to the field-cell wrapper in detail-view (required for truncate to work inside a CSS grid) — minimal, within the fix's intent.
- `updateProd` call branch also pushes 'call.logged' on review edits so the timeline reflects updated duration/outcome — small addition consistent with the fix's real-time-refresh goal.
- No DB schema changes needed.

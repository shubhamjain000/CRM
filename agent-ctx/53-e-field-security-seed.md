# Task 53-e — Field Security Enforcement (client + exports) & Seed Data v2

**Agent:** 53-e
**Status:** ✅ Complete — tsc clean (only pre-existing `src/__tests__/auth.test.ts` bun:test error), eslint 0 errors/0 warnings on all owned files, dev server compiles + serves 200.

## Files changed

| File | Change |
|---|---|
| `src/app/api/security/field-security/route.ts` | GET extended **additively** with `?mine=1` → `{ mine: { [model]: { hidden: string[], readOnly: string[] } }, roleId, canManage }` for the CALLING user's role (resolves session→tenant→role exactly like `filterWritableForCaller`/`maskRecordForCaller`; admins always get empty arrays). POST/DELETE contracts untouched. |
| `src/components/crm/use-field-security.ts` **(NEW)** | `'use client'` hook. Module-level session cache + inflight dedupe + listener fan-out; fetches `?mine=1` once per session. Returns `{ ready, hiddenFor(model): Set<string>, isReadOnly(model, key), refresh() }`. Failure → degrades to "no restrictions", never blocks UI. Also exports `securityKey()` + `FIELD_SECURITY_KEY_ALIASES` mapping UI keys → catalog keys (`email→emails`, `phone→phones`, `owner→ownerId`, `account→accountId`, `stage→stageId`). |
| `src/components/crm/record-form.tsx` | Surgical: hook called once; `stdFields` = fields filtered through `hiddenFor(module)` (memo); `fieldReadOnly()` helper. Validation loop + payload build iterate `stdFields` and SKIP read-only keys (server strips them anyway; whole-empty payload still surfaces the server's assertWritablePayload error). All 4 renderers (`renderInput`/`renderSelect`/`renderMultiselect`/`renderCheckbox`) take `ro` flag → disabled + `aria-disabled`, "Read only for your role" hint with lock glyph, label lock badge. Custom fields untouched. Preserved the email-overflow fix from the earlier agent. |
| `src/components/crm/detail-view.tsx` | Hook + `secFields` (hidden keys removed via `securityKey`); read-only editable fields render value + lock in label + Radix Tooltip "Read only for your role", inline-edit input/click paths check `!ro`. Phone fields stay tap-to-call (calls are reads, not writes). |
| `src/components/crm/views/leads.tsx` | Module-level `LEAD_COLUMN_SECURITY_KEYS` map; `visibleColumns` = columns filtered (dropped when ALL mapped catalog keys hidden) + `editable:false` when key read-only; VirtualList gets `visibleColumns`. |
| `src/components/crm/views/contacts.tsx` | Same pattern (`CONTACT_COLUMN_SECURITY_KEYS` inline; name/email/phone/owner/accountId/department/leadSource mapped; listing/csmNextStep/createdAt unmapped → never hidden). CrmTable gets `visibleColumns`. |
| `src/components/crm/views/accounts.tsx` | Same pattern (`ACCOUNT_COLUMN_SECURITY_KEYS`: name/accountType/annualRevenue/employees/website/rating). |
| `src/components/crm/views/deals.tsx` | Kanban (no columns): `amountHidden`/`probabilityHidden` gate card amount line, probability badge, stage-header totals, page summary total and hover preview. |
| `src/app/api/crm/export/route.ts` | Exports now honor the caller's role: `maskRecordsForRead(module, rows, role)` applied to the cursor-looped rows (affects CSV/JSON/PDF/DOCX uniformly) + hidden columns dropped from `cols` for non-admins via `getFieldRulesForRole`. Admins/no-rules → byte-identical output. Audit metadata unchanged. |
| `src/components/dashboard/views/security.tsx` | `FieldSecurityCard` rebuilt as a true matrix: module picker + legend; ROWS = humanized catalog fields (sticky first col), COLUMNS = roles. Own role loaded via plain GET (works non-admin); admins additionally fetch `/api/roles` + all other roles' rules via `Promise.allSettled` (failed column degrades to visible). Cells = compact Select h-7 color-coded (default/amber/destructive), optimistic POST per cell (same contract), revert + toast on failure. `overflow-x-auto` + `max-h-96 overflow-y-auto` + mobile edge fades; skeleton loading + error panel with Retry; canManage gating preserved (non-admin sees own role only, cells disabled). |
| `prisma/schema.prisma` | `isSeed Boolean @default(false)` added to **Lead, Contact, Account, Deal, Activity, Invoice** (additive). `db:push` + client regen OK. |
| `src/lib/crm/seed.ts` | `TARGETS = { accounts:30, contacts:50, leads:100, deals:20, activities:50, invoices:15 }`. `isSeed:true` on every seeder-created account/contact/lead/deal. NEW: Activities top-up (createMany; spread across lead/contact/deal/account pools w/ recordName; actions called/emailed/noted/met with realistic descriptions; createdAt spread over last 30 days; metadata `{source:'seed'}`). NEW: Invoices top-up (createMany; customerName from seeded accounts + customerEmail from seeded contacts; unique sequential `INV-2xxx` offset by existing count; 1–3 lineItems w/ consistent subtotal/tax(18%)/total; status mix draft/sent/paid/overdue; overdue dueDate in the past; issueDate spread 60d). Inventory/campaigns demo + count-based top-up idempotency untouched; fast path now also requires activities+invoices at target (legacy orgs get topped up on next click). Return shape extended with activities/invoices in created+totals. |
| `src/app/api/crm/seed/route.ts` | POST unchanged (now returns 6-key created/totals). NEW DELETE: auth+tenant gated, `$transaction` deletes ONLY `isSeed:true` rows in FK-safe order (invoices → activities → deals → contacts → leads (conversion FKs nulled first — Restrict hardening) → accounts), returns `{ ok, deleted: {invoices, activities, deals, contacts, leads, accounts}, total }`. |
| `src/components/crm/views/setup.tsx` | Two side-by-side buttons: **Seed Test Data** (secondary, DatabaseZap; AlertDialog lists 100/50/30/20/50/15 + top-up note) and **Delete All Seed Data** (destructive outline, Trash2; AlertDialog "Removes only records created by Seed Test Data — real data is never touched"). Both run behind an undissmisable progress Dialog (indeterminate `useIndeterminateProgress` ticker) with 'Seeding test data…' / 'Deleting seed data…', success toast `X records added`/`X records deleted` (0 → info toast), error toast with reason, stats refresh via loadTotals, and both disabled while any seed op runs (`busy` state). Old "Seed demo data" handler migrated onto the same POST flow. |

## Endpoint contracts

- `GET /api/security/field-security?mine=1` → `{ mine: { lead|contact|account|deal: { hidden: string[], readOnly: string[] } }, roleId, canManage }` (401/403 as usual).
- `GET/POST/DELETE /api/security/field-security` — unchanged contracts.
- `POST /api/crm/seed` → `{ ok, created: {accounts, contacts, leads, deals, activities, invoices}, totals: {...same 6 keys} }`.
- `DELETE /api/crm/seed` → `{ ok, deleted: { invoices, activities, deals, contacts, leads, accounts }, total }` (deletes ONLY isSeed rows).
- `GET /api/crm/export?module=…` — same response formats; hidden fields now stripped from rows AND columns for the calling role.

## Verification

- `bun run db:push` — in sync; Prisma Client v6.19.2 regenerated.
- Scoped `tsc -p` (src+prisma+next types; memory-capped sandbox OOMs on full-project tsc): only pre-existing `src/__tests__/auth.test.ts(6,38) bun:test` error. Zero errors in changed files.
- `bun run lint`: 0 errors (1 pre-existing `virtual-list.tsx` react-compiler warning, not owned).
- curl smoke tests (unauthenticated): root 200; `POST/DELETE /api/crm/seed`, `GET ?mine=1`, `GET /api/crm/export` all compile + respond 401 — auth gate intact. dev.log: page compiles clean after prisma regen (17.6s → 107ms steady).

## Notes for next agents

- `useFieldSecurity()` is session-cached at module level; after an admin edits rules in the matrix UI, OTHER tabs/clients refresh on their next `refresh()` call (or new session). The security matrix itself always fetches fresh on mount.
- Field-security key aliasing (`email→emails`, `phone→phones`, `owner→ownerId`) lives in `use-field-security.ts#securityKey` — reuse it for any new form/detail surface that maps onto the catalog.
- Seeded invoices/activities carry `metadata`/`isSeed` markers; DELETE is idempotent (0-total → info toast). Deleting seeded contacts SetNulls any account POC pointing at them (FK cascade, expected).

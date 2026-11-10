# Task 1-d — Contacts "Listing Intelligence" + CSV Import (Parts 1 & 4)

## Status: COMPLETE (all quality gates pass for owned files)

## Files changed (all additive)
1. `src/components/crm/record-form.tsx` — ADDED native `multiselect` field support: `renderMultiselect()` (chip-toggle buttons, mirrors the multi_picklist custom renderer), a branch in `renderField`, and a payload branch in `save()` (array pass-through). Existing field types untouched.
2. `src/components/crm/detail-view.tsx` — ADDED optional prop `sections?: DetailSection[]` (`{title, fields: {key,label,node}[]}`; exported types `DetailSection`/`DetailSectionField`). Rendered as extra `<Card>`s below the existing "Record details" card inside the Overview tab. Overview TabsContent className is now `flex-1 space-y-4` (no visual change when no sections). Leads/accounts/deals don't pass it → identical rendering.
3. `src/components/crm/views/contacts.tsx` —
   - `Contact` interface extended with the 15 new nullable listing fields.
   - New appended **Listing Intelligence** section in the RecordForm FIELDS (after Description Information): recruiterTag/premiumStatus/listingSubtype/csmRecruiterType selects (clearable), csmStatus text, reasonableFitPct/totalApplications/reasonableScoreUsers numbers, listingUrl url, listingTitle text, listingCategory multiselect (10 options, JSON-array-string storage), csmNextCallDate/dateApproved dates.
   - Edit prefill parses `listingCategory` JSON → array; dates sliced to `YYYY-MM-DD`.
   - `save()` serializes multiselect array → JSON string (null when empty) and normalizes all 12 form-owned listing empties → `null` (never ''/NaN). Does NOT touch `totalReachoutsDone`/`lastReachedOutAt` (automation-managed, not form fields).
   - Appended **Listing** column (last, after Created): Recruiter Tag pill (New=sky, Existing=teal), Premium pill (Free=grey muted, Paid=amber), Fit % badge (0–25 red / 26–50 yellow / 51–75 orange / 76–100 green; empty '—'). Print/export value included.
   - DetailView gets `sections={listingSections(detail)}` — "Listing Intelligence" card with pills/badges, real clickable `<a target="_blank" rel="noopener noreferrer">` listing URL (truncated display, full href), comma-joined categories, and all 15 fields ('—' when empty).
   - Helpers at module scope: `RecruiterTagPill`, `PremiumPill`, `FitPctBadge`, `ListingLink`, `listingSections`, picklist constants, `LISTING_NULLABLE_FIELDS`.
4. `src/lib/crm/handler.ts` — ONLY: added the 15 new columns to `MODULE_COLUMNS.contact` + light `coerceContactListingFields()` applied inside `sanitizeRecordData` for contact only (ints truncated & NaN→null, floats finite→value else null, dates parsed→Date or null on invalid, listing strings trimmed/''→null, `listingCategory` normalized to always be a JSON-array-string or null). `createTenant`/`updateTenant` logic otherwise untouched.
5. `src/app/api/crm/import/route.ts` —
   - `FieldType` + `'datetime'` (accepts `YYYY-MM-DD` and `YYYY-MM-DD HH:mm:ss` via space→T).
   - `FieldSpec` + `mapValue?` and `lenientEnum?` (additive; no existing spec sets them).
   - `IMPORT_SPECS.contact` extended with all new fields (recruiterTag/premiumStatus/listingSubtype lenient enums; premium maps yes/paid/true/1/premium→Paid, no/free/false/0→Free; subtype job(s)/internship(s)→Jobs/Internships; reasonableFitPct strips trailing `%`; listingCategory splits on `|`/`;` → JSON-array-string; csmRecruiterType strict enum First Time/Existing/New; ints for totalApplications/reasonableScoreUsers/totalReachoutsDone; dates for dateApproved(datetime)/csmNextCallDate(date)/lastReachedOutAt(datetime)). `contact.lastName` relaxed to not-required with `default: ''` (NOT NULL column safety when a single-word full_name is split). Lead/account/deal specs untouched.
   - `fullName` convenience: contact rows without explicit first/last name get `full_name` split on first space.
   - **Update semantics**: contacts with `updateExisting=true` update ONLY listing fields + title + accountId, and only when non-empty (`buildContactUpdateData`). Names/emails/phones/csmNextStep/prefs/owner/department/assistant/leadSource NEVER overwritten. Empty update payload → counted as skipped. Other modules keep previous full-rec update.
   - **Auto-assignment**: created contacts go through `applyAssignmentRules({model:'contact', record: rec, fallbackOwnerId: session.userId})`; `recordAssignment` after each create. Active-rule count prefetched to skip the engine per-row when org has no contact rules. Lead/account/deal create path byte-identical to before (chunked createMany, owner=session user).
6. `src/components/crm/import-wizard.tsx` — contact MODULE_FIELDS gains `fullName` + all listing/csm fields (mappable + template); AUTO_ALIASES additions (fullname, emailid→emails, mobileno→phones, listinglink/subtype/category/applications/reasonablefit/premium/dateapproved/csm* etc. — all additive); `requiredMissing` treats mapped fullName as covering firstName; contact+updateExisting shows a "only Listing Intelligence + title/company are refreshed" note; done step shows "New contacts were auto-assigned by your assignment rules" when `module==='contact' && created>0` (counts + per-row reasons list already existed).

## Key API shapes for downstream agents
- `IMPORT_SPECS.contact` new entries (exact):
```ts
recruiterTag: { type: 'string', enumValues: ['New Recruiter', 'Existing Recruiter'], lenientEnum: true },
premiumStatus: { type: 'string', enumValues: ['Free', 'Paid'], lenientEnum: true, mapValue: premiumCsvValue },
listingSubtype: { type: 'string', enumValues: ['Jobs', 'Internships'], lenientEnum: true, mapValue: job→'Jobs'/internship→'Internships' mapper },
totalApplications: { type: 'int' },
reasonableFitPct: { type: 'number', mapValue: (v) => v.replace(/%\s*$/, '').trim() },
reasonableScoreUsers: { type: 'int' },
listingUrl: { type: 'string', maxLen: 500 },
listingTitle: { type: 'string', maxLen: 300 },
listingCategory: { type: 'string', maxLen: 1000, mapValue: listingCategoryCsvValue }, // splits | or ; → JSON array string
dateApproved: { type: 'datetime' },
csmRecruiterType: { type: 'string', enumValues: ['First Time', 'Existing', 'New'] },
csmStatus: { type: 'string', maxLen: 200 },
csmNextCallDate: { type: 'date' },
totalReachoutsDone: { type: 'int' },
lastReachedOutAt: { type: 'datetime' },
// plus lastName relaxed: { type: 'string', maxLen: 100, default: '' }
```
- `MODULE_COLUMNS.contact` now also contains: recruiterTag, premiumStatus, listingSubtype, totalApplications, reasonableFitPct, reasonableScoreUsers, listingUrl, listingTitle, listingCategory, dateApproved, csmRecruiterType, csmStatus, csmNextCallDate, totalReachoutsDone, lastReachedOutAt.
- DetailView additive prop: `sections?: { title: string; fields: { key: string; label: string; node: React.ReactNode }[] }[]` (exported as `DetailSection`).
- RecordForm `multiselect` FieldType is now functional: options via `options`, value is `string[]`.

## Conventions to respect
- `listingCategory` is ALWAYS a JSON-array-string in DB (or null) — parse with `safeJsonParse<string[]>(raw, [])`.
- Empty listing values are stored as SQL NULL, never `''`.
- Contact import update path is intentionally narrow (listing fields + title/accountId only) — don't widen it.

## Gotchas discovered
- Contact model `lastName` is NOT NULL — single-word `full_name` rows need `default: ''` (already handled).
- Port 3000 isn't reachable via curl from agent shells (different netns) — verify via `bun run lint`/`bunx tsc` and dev.log only.
- `src/lib/csm.ts` does NOT exist (only `src/lib/csm.ts`-equivalents: `@/lib/csm` client consts and `src/lib/crm/csm-workflow.ts`). Listing picklists live in `contacts.tsx` instead.

# Task 3-b — API & BI Integration (API keys + public v1 REST API + admin UI)

## Status: COMPLETE (tsc clean for owned files, `bun run lint` 0 errors)

## Files created
1. `src/lib/api-keys.ts` — `ApiAuthError` (status-carrying), `hashApiKey` (sha256 hex), `generateApiKey({ session, name, scopes, expiresAt })` (key = `sk_live_` + 32 random bytes base64url; stores ONLY sha256 hash + 12-char prefix; org from `getTenant`; audits `apikey.create`; returns `{ record, key }` with plaintext shown once), `authenticateApiKey(req)` (X-API-Key header or Bearer; 401 missing/invalid, 403 revoked/expired/no-org; fire-and-forget `lastUsedAt` touch; returns `{ apiKey, organizationId, userId, scopes }`), `requireScope(auth, scope)` (403 `API key missing '<scope>' scope`).
2. `src/app/api/settings/api-keys/route.ts` — GET lists org keys (non-admins see only own; `keyHash` NEVER returned; maps to `{ id, name, keyPrefix, scopes[], lastUsedAt, expiresAt, revokedAt, createdAt, ownerName, isOwn }` + `isAdmin` flag). POST `{ name (1–80), scope: 'read'|'write', expiresInDays?: 30|60|90 }` → 201 `{ id, key (plaintext, once), name, keyPrefix, scopes, expiresAt, createdAt }`. Errors `{ error }` 401/403/400.
3. `src/app/api/settings/api-keys/[id]/route.ts` — DELETE revoke (owner or `org.admin`; scoped by id+organizationId, 404 else; sets `revokedAt`; audits `apikey.revoke`; returns `{ ok: true }`). Next 15 `params: Promise<{ id }>` convention.
4. `src/app/api/public/v1/_helpers.ts` — shared public-API plumbing: envelope helpers (`publicOk`, `publicFail`, `handlePublicError`), `parseListQuery` (page/limit clamped 1–100, `modified_since` → 400 `Invalid modified_since datetime`), `loadCustomFieldMap(org, module, ids)` (active CustomFields + CustomFieldValues → recordId → `{ apiName: parsed }`), `ownerNameMap` (batch user names), serializers `serializeContact/serializeLead/serializeDeal` (recursive Date→ISO, JSON-array parsing of emails/phones/listingCategory → real arrays ([] on failure), flattens `accountName`/`stageName`/`pipelineName`/`ownerName`, spreads `customFields`, drops nothing).
5. `src/app/api/public/v1/ping/route.ts` — GET, read scope → `{ ok, data: { organization, organizationId, apiVersion: 'v1', timestamp } }`.
6. `src/app/api/public/v1/contacts/route.ts` — GET paginated list (org-scoped + deletedAt null, updatedAt desc, include account name, count for pagination.total, custom fields merged per page). POST create with write scope: `firstName` required (400 `firstName is required`), strict whitelist (23 string cols trimmed ≤10 000 empty→null — except `lastName` empty→'' because column is NOT NULL; 8 int cols truncated + `reasonableFitPct` float; 6 date cols parsed or null; `email`/`phone` → JSON-array `emails`/`phones` when valid), unknown keys ignored; ownerId = explicit org member → key's user → org's first active member → 400 `Organization has no users`; audits `api.contact.create`; 201 `{ ok, data: serialized }`.
7. `src/app/api/public/v1/contacts/[id]/route.ts` — GET single, 404 `{ ok: false, error: 'Contact not found' }`, custom fields + ownerName included.
8. `src/app/api/public/v1/leads/route.ts` — GET only, same envelope, module 'lead' custom fields.
9. `src/app/api/public/v1/deals/route.ts` — GET only, includes stage/account/pipeline names (relations confirmed in schema), module 'deal' custom fields.
10. `src/components/dashboard/views/api-keys.tsx` — 'use client' admin view modeled on security.tsx: header + Create key; "Your API keys" card (name, `<code>{keyPrefix}…</code>`, scope badges read=secondary/write=default, created/last-used relative/owner, Active emerald / Expired amber / Revoked muted badges, Ban icon revoke w/ confirm dialog + pending state); create dialog (name, two toggle-card scope options, expiry Select never/30/60/90) → on success REPLACES content with shown-once panel (monospace key, amber warning, Copy→Check button w/ execCommand fallback, Done); "Connect your BI tool" docs card (origin computed post-mount to avoid hydration mismatch, base URL code block, auth headers, endpoint mini-table GET/POST with per-row descriptions, pagination + modified_since notes, two copy-able curl examples incl. incremental sync, Power BI/Tableau/Metabase/Sheets guidance). Skeleton loading, error+retry, max-h-96 overflow lists w/ custom scrollbar styling, no blue/indigo.
11. `agent-ctx/3-b-api-keys.md` — this record.

## Files modified
- `src/components/dashboard/dashboard-shell.tsx` — added `'api-keys'` to `ViewKey` union; imported `KeyRound`; nav item `{ key: 'api-keys', icon: KeyRound, label: t('nav.apiKeys') }` directly after the 'security' entry in navSections.
- `src/app/page.tsx` — lazy `ApiKeysView` dynamic import + `{view === 'api-keys' && <ApiKeysView />}` right after the security case.
- `src/components/dashboard/command-palette.tsx` — imported `KeyRound`; Navigate CommandItem for `api-keys` right after the security item.
- `src/i18n/messages/en.json` — ONLY: new top-level `apiKeys` namespace (60 keys) + `"apiKeys": "API & BI"` inside `nav`. No other locale files touched.
- `src/lib/openapi.ts` — added `apiKeyAuth` security scheme (X-API-Key header, notes Bearer alt) and paths: `/settings/api-keys` (GET/POST), `/settings/api-keys/{id}` (DELETE), `/public/v1/ping`, `/public/v1/contacts` (GET+POST), `/public/v1/contacts/{id}` (GET), `/public/v1/leads` (GET), `/public/v1/deals` (GET).

## New en.json keys (exact strings) — `apiKeys.*` unless noted
- `nav.apiKeys` = "API & BI"
- title = "API & BI Integration"
- description = "Create API keys so Power BI, Tableau, Metabase, Google Sheets and custom scripts can pull your CRM data automatically."
- createKey = "Create key"; createDesc = "Name the key so you can recognise it later, pick a scope and an optional expiry."
- yourKeys = "Your API keys"; yourKeysDesc = "Keys that can access this organization's data via the REST API."; yourKeysDescAdmin = "All keys in this organization — as an admin you can revoke any of them."
- empty = "No API keys yet. Create one to connect your BI tools."; loadFailed = "Failed to load API keys"
- keyName = "Key name"; keyNamePlaceholder = "e.g. Power BI — sales dashboard"
- scope = "Scope"; scopeRead = "Read-only"; scopeReadDesc = "Pull data into BI tools"; scopeWrite = "Read & write"; scopeWriteDesc = "Also create records via API"
- expiry = "Expiration"; expiryNever = "Never expires"; expiry30 = "30 days"; expiry60 = "60 days"; expiry90 = "90 days"
- keyCreated = "API key created"; keyShownOnce = "Copy this key now — for security it will never be shown again."
- copy = "Copy"; copied = "Copied!"; copyFailed = "Could not copy to clipboard"; done = "Done"
- revoke = "Revoke key"; revokeTitle = "Revoke API key"; revokeDesc = "This will permanently revoke \"{name}\". Any tool using this key will immediately lose access. This cannot be undone."; revoked = "API key revoked"
- active = "Active"; expired = "Expired"; statusRevoked = "Revoked"
- lastUsed = "Last used"; never = "Never"; created = "Created"; owner = "Owner"
- docsTitle = "Connect your BI tool"; docsIntro = "Point any REST client or BI connector at the base URL below and authenticate with your API key."
- baseUrl = "Base URL"; authHeader = "Authentication"; endpoints = "Endpoints"; endpoint = "Endpoint"; method = "Method"; scopeCol = "Scope"; descriptionCol = "Description"
- pagination = "Pagination:"; paginationDesc = "list endpoints accept page and limit (max 100) query parameters and return a pagination block with total counts."
- incremental = "Incremental sync:"; incrementalDesc = "pass modified_since=ISO datetime to fetch only records updated after that moment — ideal for scheduled refreshes."
- curlExample = "Quick start (curl)"; biGuide = "BI connectors"; biGuideBody = "Power BI: Get Data → Web connector, paste the base URL and add the X-API-Key header under Advanced options. Tableau: use a Web Data Connector pointing at the contacts endpoint. Metabase and Google Sheets: any REST/JSON connector works — authenticate with the key, then set a refresh schedule so the data is pulled automatically."
- epPing = "Test the connection"; epContactsList = "List contacts (paginated)"; epContactsGet = "Get one contact by id"; epContactsCreate = "Create a contact (write key required)"; epLeads = "List leads (paginated)"; epDeals = "List deals (paginated)"

## Conventions for downstream agents
- Public v1 envelope: list `{ ok, data[], pagination{page,limit,total,totalPages} }`, single `{ ok, data{...} }`, error `{ ok, error }` with ApiAuthError.status. Never call `getSession` under `/api/public/v1` — API-key auth only.
- `ownerName` is resolved by batch `db.user.findMany` (Contact/Lead/Deal store `ownerId` as a plain string column — there is NO Prisma owner relation on these models; don't try `include: { owner }`).
- Settings API-key routes return `{ error }` bodies (session-auth convention), NOT the public `{ ok, error }` envelope.

## Gotchas
- `Contact.lastName` is NOT NULL → API create maps empty/missing lastName to `''` (all other whitelisted strings empty→null).
- `modified_since` invalid → 400 (thrown as ApiAuthError from `parseListQuery`, mapped by `handlePublicError`).
- `messages: Record<Locale, typeof en>` in `src/i18n/messages.ts` will keep tsc failing until the locale agent mirrors the `apiKeys` namespace into the other 11 locale JSONs (expected; NOT mine to fix).

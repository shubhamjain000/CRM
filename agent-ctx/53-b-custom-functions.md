# Task 53-b — Custom Functions: honest sandbox failures + PDF download from functions

**Agent:** 53-b
**Status:** ✅ Complete — lint 0 errors, tsc 0 new errors, sandbox path runtime-verified

## Files changed (owned list only)

| File | Change |
|---|---|
| `src/lib/custom-functions/pdf.ts` (NEW) | Server-side PDF builders. `buildInvoicePdf({number?, date?, dueDate?, from?, to?, items:[{description,qty,price}], taxPercent?, currency?})` and `buildDocumentPdf({title, lines:[{text,size?,bold?}]})` → `{ filename, base64, sizeBytes }`. Dynamic `await import('jspdf')`; A4 layout mirrors `src/lib/invoice-docs.ts` (navy band, zebra rows, page-breaks, footer) with the same glyph-safe "Rs." en-IN money (₹ has no Helvetica glyph; `₹`/`INR` currency strings are mapped to `Rs.`). Filenames: `Invoice-<number\|timestamp>.pdf` / `<title-slug>.pdf`. Every validation problem throws a clear message (`items` empty, non-numeric qty/price, missing title, non-numeric size); jsPDF failures wrapped as `pdf.invoice failed: …` / `pdf.document failed: …`. |
| `src/lib/custom-functions/handler.ts` | FIX A + sandbox `pdf` API (details below). Response shape `{executionId, status, output, logs, error, executionTimeMs}` unchanged; execute route still answers HTTP 200 with `status:'failed'` for runtime failures. |
| `src/components/custom-functions/views/editor.tsx` | Test output panel + execute UX (details below). |

## FIX A — live results, no silent failures

1. **Allowlist now throws.** `http.get/post` on a non-allowlisted hostname throw exactly: `` Domain "<host>" is not in the HTTP allowlist. Add it in Functions settings before calling external APIs. `` (was: fake `{status:403, body:'Domain not in allowlist'}` success). Invalid URLs throw `http.get: invalid URL "…"`; fetch failures throw `http.<method> to "<host>" failed: <reason>` — a target server's real 403 still passes through genuinely.
2. **Honest send stubs.** `send_email(to, subject, body)` → `{ simulated: true, to, subject }` + log `send_email simulated (no mail provider configured): to=<to> subject=<subject>`; `send_sms(to, body)` → `{ simulated: true, to }` + analogous log. Nothing claims real delivery. 'Send WhatsApp on Stage Change' template updated to return `{ simulated, to }` instead of `{ sent: true }`.
3. **Promise.race loser guarded.** Both `result` (user promise) and the timeout promise get pre-attached `.catch(() => {…})` so post-timeout rejections / late timer firings can't become unhandled rejections; timer is `clearTimeout`'d in `finally`. Timeout message is exactly `Execution timed out after 5s`.
4. **runSandboxed never throws.** Whole body (vm import, context creation, run, race) inside one try/catch returning `{ output: null, logs, error }`; executeFunction's last-resort catch documents that the execution row is still updated and the API returns HTTP 200 + `status:'failed'` so the UI can render the reason.
5. **CRITICAL latent bug found & fixed:** the old wrapper `const {…} = api; …; return (async () => { code })();` compiled as a vm **Script** → top-level `return` is illegal → **every** execution failed with `Illegal return statement`. Verified empirically under node. New wrapper is a single async-IIFE expression statement (runInNewContext returns its completion value = the Promise); tenant `return` is function-scoped and legal. Verified: template now resolves.

## FIX B — PDF from within a function

- **Sandbox API:** `pdf.invoice(data)` / `pdf.document({title, lines})` (async, destructure `pdf` in tenant code), each pushing `PDF generated: <filename> (<n> KB)` and an `[ERROR] pdf.… failed: …` log line before rethrowing. Full API surface documented in the expanded JSDoc above `runSandboxed` and in the editor hint.

  ```js
  // exact call shape inside a custom function:
  const file = await pdf.invoice({
    number: 'INV-1001',
    to: { name: 'Acme Corp' },
    items: [{ description: 'Consulting', qty: 2, price: 12500 }],
    taxPercent: 18,
  });            // → { filename, base64, sizeBytes }
  await pdf.document({ title: 'Report', lines: [{ text: 'Hello', bold: true }] });
  ```

- **Template 'Generate Invoice PDF' actually works** with default input `{"record_id":"test-id"}`: `crm.deals.get` null → demo fallbacks (amount 49999, one demo line item, 18% tax), `await pdf.invoice(details)`, returns `{ invoice, pdf }` (variable named `pdfFile` to avoid shadowing the `pdf` API). Verified by executing the extracted template string in `node:vm` with the real builder: output keys `[invoice, pdf]`, `pdf` base64 starts `%PDF-`, ~5.8 KB, logs both `PDF generated: …` and the template log line.
- **UI (output panel):** when `testResult.output` contains `pdf`/`__pdf` with `{filename, base64, sizeBytes}` → prominent emerald card with filename + size in KB + "Download PDF" button (FileDown icon, Loader2 spinner + disabled while preparing, success toast, failure toast with reason). Base64 never rendered: JSON view shows `'<base64 PDF — use Download button>'` (deep-collapsed copy). `failed` → red alert box (prominent reason + last 3 log lines); `completed` → green badge + ms; empty state "Run a test to see live output"; executing state → inline spinner. Execute button spinner+disabled; HTTP/JSON failures → toast **and** inline error box (`executeError`). Fixed a panel-wiping bug: `loadDetail(id, {keepResult:true})` after execute so the result isn't cleared. Optional API-reference hint line added under the code textarea.

## Verification

- Runtime (bun/node, not repo test code): both builders emit `%PDF-` files with correct slugs; 3 validation errors throw with exact messages; template executes in `node:vm` end-to-end with default input; old wrapper reproduced `Illegal return statement`, new wrapper resolves.
- `bun run lint`: **0 errors** (1 pre-existing warning in `src/components/crm/virtual-list.tsx`, out of scope).
- `bunx tsc --noEmit`: only the 3 pre-existing errors (examples/websocket, skills/image-edit, `__tests__/auth.test.ts`) — **zero new**.
- `dev.log`: server healthy, no compile errors. Curl to :3000 unreachable from this shell (namespace) + auth-gated → static verification per task note.

## Notes for next agents

- PDF base64 rides inside `CustomFunctionExecution.outputData` (SQLite TEXT) — a ~6 KB PDF ≈ 8 KB base64; fine, but huge PDFs inflate history rows.
- The vm-wrapper fix changes no response shape but makes ALL previously-SyntaxErroring functions start executing for real — existing "failed" history rows were mostly this bug, not user-code errors.
- `send_email`/`send_sms` return values are now objects; any function that relied on `undefined` return is unaffected, but code doing `if (!send_sms(...))` semantics would differ.

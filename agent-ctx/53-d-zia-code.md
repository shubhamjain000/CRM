# Task 53-d — AI Ask Agent (Zia) redesign + AI email templates with record context

## Files changed

**New**
- `src/components/ai/chat-markdown.tsx` — `<ChatMarkdown text>`: react-markdown ^10.1.0 + remark-gfm, GFM component map (h1–h4 prose-sized, ul/ol, strong, links target=_blank rel=noopener, tables in `overflow-x-auto` wrapper with compact bordered cells, inline `code` as muted chip), fenced code → `CodeBlock` (react-syntax-highlighter Prism, `oneLight` in light theme / `vscDarkPlus` in dark via next-themes `resolvedTheme`, language label, one-click Copy with Check swap 2s, overflow-x for long lines). No `rehype-raw` (HTML escaped by default) + `MarkdownErrorBoundary` falls back to plain text if parsing ever throws.
- `src/app/api/ai/email-template/route.ts` — POST contextual email generation (contract below).

**Edited**
- `src/components/ai/zia-chatbot.tsx` — restructured freely (self-contained). Data flow preserved 100%: history GET `/api/ai/chat`, send POST, action chips → green pills (task/event/csm), clear via POST `{message:'__clear__', action:'clear'}`, `historyLoading`, abort-on-close, clear-epoch race guard.
- `src/lib/ai/handler.ts` — only the FORMATTING rule in `buildSystemPrompt()` (~L348): now REQUIRES clean GitHub-flavored markdown (short headings, "- " bullets, bold key figures, tables for comparisons, fenced code with language tags). JSON action protocol untouched — actions still work.
- `src/components/crm/compose-email-dialog.tsx` — additive AI panel; template picker, merge fields, CC/BCC validation, mailboxes, send flow untouched. `DialogContent` got `max-h-[90dvh] overflow-y-auto` so the taller dialog stays scrollable.
- `src/app/globals.css` — appended a single clearly-marked `/* 53-d: AI chat markdown */` section (scrollbars for `.zia-chat` viewport, `.zia-md` first/last child margin reset, `.zia-code` horizontal scrollbar + rounded pre).
- `package.json` / `bun.lock` — via `bun add remark-gfm` (remark-gfm@4.0.1) only.

## Zia chatbot (FIX 8) highlights
- User messages right with User-icon circle avatar + accent-tinted bubble (`bg-primary/15` + `border-primary/25`); agent left with Sparkles circle avatar on `bg-muted`; both `max-w-[85%]` on mobile; small `10px` timestamps under bubbles (server history has none → hidden).
- Agent messages render through `ChatMarkdown`; user messages stay plain `whitespace-pre-wrap`.
- Typing indicator: agent-side bubble, 3 bouncing dots with 0/150/300ms delays.
- Auto-scroll: jump on first history load + own send; follows new replies; paused via scrollTop-distance check (>140px from bottom while loading) until next send.
- Header "Ask Zia": Copy response (last agent markdown, disabled if none, Check 2s), Clear chat behind AlertDialog confirm, close X; Esc-to-close kept; panel size/position classes unchanged; flex-col with pinned composer.
- Composer: auto-expanding Textarea (1 → max ~5 rows / 120px), Enter = newline, Ctrl/Cmd+Enter = send, 44px send button, hint "Ctrl+Enter to send", disabled while loading; suggested-prompt chips kept (44px targets).
- Errors: agent-side destructive bubble "Something went wrong: <reason>" + Retry that drops the error and resends the last user message through the same POST path.

## Email-template API contract (FIX 15)
`POST /api/ai/email-template` (session required)

Request:
```json
{
  "category": "follow_up | introduction | proposal | reminder",
  "module":   "lead | contact | deal | account",
  "recordId": "cuid…",
  "instruction": "mention the 20% discount",
  "context": { "name": "…", "company": "…", "ownerName": "…" }
}
```
(`module` required when `recordId` given; `recordId`/`context` optional → generic mode without a record; `instruction` optional ≤500 chars.)

Response 200:
```json
{
  "subject": "…",
  "body": "plain text, \n\n paragraphs",
  "category": "follow_up",
  "variables": { "first_name": "", "last_name": "", "full_name": "", "email": "", "phone": "", "company": "", "deal_name": "", "deal_stage": "", "owner_name": "", "date": "" }
}
```
- Record load is tenant-scoped (`organizationId`, `deletedAt: null`): lead (names/company/status/rating), contact (+account company, cadence step), deal (stage, value, primary contact, account, close date), account (name/type/industry/revenue) + owner user name.
- `{{…}}` placeholders the model still emits are resolved SERVER-side with real record values (unknown tokens left visible → client shows "{{company}} unresolved — showing fallback").
- Errors: 401 unauthorized · 400 invalid/missing category·module·instruction · 404 record not found · 500 `{error}` (SDK failure / unusable LLM response) — never silent.
- Best-effort `AIWriterDraft` row persisted (never fails the response).
- SDK call mirrors `src/lib/ai/handler.ts` (`ZAI.create()` → `chat.completions.create` with `thinking: disabled`, tolerant `extractJson`).

ComposeEmailDialog AI panel: "Write with AI" (Sparkles) toggles panel above the body editor → 4 category chips (44px) + optional instructions input → Generate (spinner) → editable Subject/Body preview → Regenerate (RefreshCw, keeps panel + compose window untouched) → "Use Template" injects subject + `textToHtml()` body (same `applyTemplate` injection path: `\n\n`→`<p>`, `\n`→`<br/>`), closes panel, success toast. Errors: inline red text + toast. No relatedId → still generates via `context` fields (API generic mode).

## Verification
- `bun run lint` → **0 errors, 1 pre-existing warning** (`virtual-list.tsx` react-hooks/incompatible-library, not mine). An earlier parsing error I introduced (raw triple-backticks inside a template literal in handler.ts) was fixed by escaping them; the `notification-shared.ts` error seen mid-run was another agent's in-flight file and is now gone.
- `bunx tsc --noEmit` → exit 2 with ONLY the 3 documented pre-existing errors: `examples/websocket/server.ts` (socket.io types), `skills/image-edit/scripts/image-edit.ts` (images prop), `src/__tests__/auth.test.ts` (bun:test). Zero errors in src app code. (Note: full tsc OOM-kills (exit 137) when the dev server is under memory pressure — a scoped tsconfig over my scope files returned exit 0, and a later full run confirmed the 3 pre-existing errors only.)
- dev.log: `GET / 200`, `POST /api/ai/email-template 401` (compiles; auth gate checked first), `GET /api/ai/chat 401` — no compile errors.

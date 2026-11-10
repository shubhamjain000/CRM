import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { createProd, detectConflicts } from '@/lib/productivity/handler'
import { CSM_VALUES, csmDueDate } from '@/lib/csm'
import { updateTenant } from '@/lib/crm/handler'
import { ActionError, buildCrmSnapshot, searchCrmRecords, type SearchParams } from './crm-context'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

let zaiInstance: ZAI | null = null
async function getZAI() {
  if (!zaiInstance) zaiInstance = await ZAI.create()
  return zaiInstance
}

// ---------------------------------------------------------------------------
// Zia Chatbot — uses z-ai-web-dev-sdk LLM with CRM context + action execution.
// Zia is a BROAD general-purpose assistant (knowledge, writing, analysis,
// research via live web search, code…) that additionally sees the user's live
// CRM data and acts on it. The model must answer with a single JSON object:
// either {"reply": "..."} for conversation, or {"action": "<name>",
// "params": {...}} to run a tool or create work (tasks / to-dos / calendar
// events). The server — never the client — executes validated actions through
// the same audited, tenant-scoped createProd path used by the regular UI.
// ---------------------------------------------------------------------------

const PRIORITIES = ['low', 'medium', 'high', 'urgent']
const TASK_STATUSES = ['not_started', 'in_progress', 'completed', 'deferred']
// Mutating actions the server executes on the model's behalf. `search_records`
// (CRM) and `web_search` (public internet) are handled separately by the
// read-only tool loop below.
const KNOWN_ACTIONS = new Set(['create_task', 'create_todo', 'create_event', 'set_next_step'])
const SEARCH_ACTION = 'search_records'
const WEB_SEARCH_ACTION = 'web_search'
/** Max read-only tool round-trips per chat message (latency guard). */
const MAX_TOOL_ITERATIONS = 3

interface ActionResult { reply: string; id?: string; label?: string }
type ParsedOutput =
  | { kind: 'action'; action: string; params: Record<string, unknown>; reply?: string }
  | { kind: 'reply'; reply: string }
  | null
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

interface LLMUsage {
  inputTokens: number
  outputTokens: number
  model?: string
}

/**
 * Call the LLM and return both the content and the provider-reported token
 * usage (when the SDK exposes it). Usage feeds the real AICostLog accounting
 * instead of fabricated numbers.
 */
async function callLLM(messages: ChatMessage[]): Promise<{ content: string; usage: LLMUsage | null }> {
  try {
    const zai = await getZAI()
    const completion = await zai.chat.completions.create({
      messages: messages as Parameters<typeof zai.chat.completions.create>[0]['messages'],
      thinking: { type: 'disabled' },
    })
    const content = completion.choices?.[0]?.message?.content ?? ''
    const rawUsage = (completion as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }; model?: string }).usage
    const usage: LLMUsage | null = rawUsage
      ? {
          inputTokens: rawUsage.prompt_tokens ?? 0,
          outputTokens: rawUsage.completion_tokens ?? 0,
          model: (completion as { model?: string }).model,
        }
      : null
    return { content, usage }
  } catch {
    return { content: '', usage: null }
  }
}

/**
 * Live web search via the SDK's built-in web_search function. Powers Zia's
 * broad, up-to-date answers (news, prices, facts, anything outside the CRM).
 * Returns compact model-facing lines; failures surface as ERROR: text so the
 * model can still answer from its own knowledge.
 */
async function runWebSearch(params: Record<string, unknown>): Promise<string> {
  const query = strParam(params.query, 300)
  if (!query) throw new ActionError('What should I search the web for? Give me a search query.')
  const numRaw = typeof params.num === 'number' ? Math.trunc(params.num) : 5
  const num = Math.min(Math.max(numRaw, 1), 8)
  const recencyRaw = typeof params.recency_days === 'number' ? Math.trunc(params.recency_days) : undefined
  const recency = recencyRaw && recencyRaw > 0 ? Math.min(recencyRaw, 365) : undefined

  const zai = await getZAI()
  const results = await zai.functions.invoke(WEB_SEARCH_ACTION, {
    query,
    num,
    ...(recency ? { recency_days: recency } : {}),
  })
  if (!Array.isArray(results) || results.length === 0) {
    return `NO_RESULTS: the web search for "${query}" returned nothing. Answer from your own knowledge and say the data could not be verified online.`
  }
  const lines = results.map((r, i) => {
    const host = typeof r.host_name === 'string' && r.host_name ? ` — ${r.host_name}` : ''
    const date = typeof r.date === 'string' && r.date.trim() ? ` (${r.date.trim()})` : ''
    const snippet = (typeof r.snippet === 'string' ? r.snippet : '').slice(0, 400)
    return `[${i + 1}] ${r.name}${host}${date}\n    URL: ${r.url}\n    ${snippet}`
  })
  return [`WEB_RESULTS for "${query}":`, ...lines].join('\n')
}

/** Tolerant JSON extraction: strips a code fence that WRAPS the JSON object.
 * Only leading/trailing fences are removed — fences inside the JSON string are
 * real markdown code blocks in the model's reply and must survive. (The old
 * global ```-stripping regex destroyed every fenced code block in answers.) */
function extractJson(text: string): Record<string, unknown> | null {
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^```(?:json)?[ \t]*\r?\n?/i, '')
  cleaned = cleaned.replace(/\r?\n?[ \t]*```[ \t]*$/i, '')
  const s = cleaned.indexOf('{')
  const e = cleaned.lastIndexOf('}')
  if (s === -1 || e <= s) return null
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(s, e + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function parseModelOutput(raw: string): ParsedOutput {
  const obj = extractJson(raw)
  if (!obj) {
    // Salvage pass: the model sometimes emits nearly-valid JSON (raw newline
    // inside the string, smart quotes…). Recover the reply value directly
    // instead of failing the whole turn.
    const salvaged = salvageReply(raw)
    return salvaged ? { kind: 'reply', reply: salvaged.trim() } : null
  }
  if (typeof obj.action === 'string' && obj.params && typeof obj.params === 'object' && !Array.isArray(obj.params)) {
    return {
      kind: 'action',
      action: obj.action,
      params: obj.params as Record<string, unknown>,
      reply: typeof obj.reply === 'string' ? obj.reply : undefined,
    }
  }
  // Tolerate the nested shorthand the model sometimes produces:
  // {"search_records": {...}} instead of {"action": "search_records", "params": {...}}
  for (const [k, v] of Object.entries(obj)) {
    if ((k === SEARCH_ACTION || KNOWN_ACTIONS.has(k)) && v && typeof v === 'object' && !Array.isArray(v)) {
      return { kind: 'action', action: k, params: v as Record<string, unknown> }
    }
  }
  if (typeof obj.reply === 'string') return { kind: 'reply', reply: obj.reply }
  return null
}

/** Extract the "reply" string value from malformed JSON output. */
function salvageReply(text: string): string | null {
  const m = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (!m) return null
  try {
    return JSON.parse(`"${m[1]}"`) as string
  } catch {
    return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** String param: trimmed, length-capped, empty → undefined. */
function strParam(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t.slice(0, max) : undefined
}

function fmtDateTime(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(d)
  } catch {
    return d.toISOString()
  }
}

function fmtTime(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone: tz }).format(d)
  } catch {
    return d.toISOString()
  }
}

/** Set the CSM cadence next step on a contact — reuses the audited updateTenant path so due dates, follow-up tasks and the timeline happen exactly like the UI. */
async function executeNextStepAction(
  params: Record<string, unknown>,
  tz: string,
): Promise<ActionResult> {
  const step = strParam(params.step, 40)
  if (!step) throw new ActionError('Which cadence step should I set? (Day 0, Day 1 Reconnect, Day 3 Call, …)')
  if (!(CSM_VALUES as readonly string[]).includes(step)) {
    throw new ActionError(`"${step}" is not a valid cadence step. Choose one of: ${CSM_VALUES.join(', ')}.`)
  }

  const name = strParam(params.contact, 120)
  if (!name) throw new ActionError('Which contact should I update? Give me the person\'s name and I will set it.')

  const { tenant } = await ctx()
  const tokens = name.toLowerCase().split(/\s+/).filter(Boolean)
  const candidates = await db.contact.findMany({
    where: { organizationId: tenant.organization.id, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, csmNextStep: true },
    take: 500,
  })
  const fullName = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.toLowerCase()
  let matches = candidates.filter((c) => tokens.every((t) => fullName(c).includes(t)))
  if (matches.length === 0) matches = candidates.filter((c) => tokens.some((t) => fullName(c).includes(t)))
  if (matches.length === 0) {
    throw new ActionError(`I could not find a contact matching "${name}" in your organization. Check the spelling and try again.`)
  }
  if (matches.length > 1) {
    const exact = matches.find((c) => fullName(c) === name.toLowerCase())
    if (!exact) {
      const list = matches.slice(0, 5).map((c) => `• ${c.firstName} ${c.lastName}`).join('\n')
      throw new ActionError(`I found several matching contacts:\n${list}\nWhich one did you mean?`)
    }
    matches = [exact]
  }
  const contact = matches[0]
  const contactName = `${contact.firstName} ${contact.lastName}`.trim()

  if ((contact.csmNextStep || 'None') === step) {
    return { reply: `${contactName} is already on “${step}”.` }
  }

  // Full workflow: server stamps csmNextStepAt/DueAt, completes the old
  // follow-up task, creates the new one and writes the timeline entry.
  await updateTenant('contact', contact.id, { csmNextStep: step })

  const due = csmDueDate(step)
  const lines = [`✅ Next step set — ${contactName} → ${step}`]
  if (due) lines.push(`Follow-up due: ${fmtDateTime(due, tz)}`)
  lines.push('The follow-up task is in your Tasks list and BI is updated.')
  return { reply: lines.join('\n'), id: contact.id, label: `${contactName} → ${step}` }
}

async function executeTaskAction(
  params: Record<string, unknown>,
  sessionUserId: string,
  tz: string,
): Promise<ActionResult> {
  const title = strParam(params.title, 200)
  if (!title) throw new ActionError('What should the task be called? Give me a short title and I will create it.')

  const dueDate = parseDate(params.dueDate)
  const reminder = parseDate(params.reminder)
  const priorityRaw = typeof params.priority === 'string' ? params.priority.toLowerCase().trim() : ''
  const statusRaw = typeof params.status === 'string' ? params.status.toLowerCase().trim() : ''

  const data: Record<string, unknown> = {
    title,
    priority: PRIORITIES.includes(priorityRaw) ? priorityRaw : 'medium',
    status: TASK_STATUSES.includes(statusRaw) ? statusRaw : 'not_started',
    // AI-created work lands on the requester so it appears in Today / My tasks
    assigneeId: sessionUserId,
  }
  const description = strParam(params.description, 2000)
  if (description) data.description = description
  if (dueDate) data.dueDate = dueDate
  if (reminder) data.reminder = reminder

  const task = await createProd('task', data)

  const lines = [`✅ Task created — "${title}"`]
  if (dueDate) lines.push(`Due: ${fmtDateTime(dueDate, tz)}`)
  if (data.priority !== 'medium') lines.push(`Priority: ${data.priority}`)
  lines.push('You will find it in your Tasks list.')
  return { reply: lines.join('\n'), id: task.id, label: title }
}

async function executeEventAction(
  params: Record<string, unknown>,
  tz: string,
): Promise<ActionResult> {
  const title = strParam(params.title, 200)
  if (!title) throw new ActionError('What should the event be called? Give me a title and a time and I will schedule it.')

  const start = parseDate(params.start)
  if (!start) throw new ActionError('When should I schedule that? Give me a date and time (for example "Friday 3pm").')

  const allDay = params.allDay === true
  // LLMs sometimes botch end-time arithmetic (observed: "Friday 3pm" → end 60h
  // later). Clamp to a sane duration window, otherwise default to 1 hour
  // (24h for all-day).
  let end = parseDate(params.end)
  const durationMs = end ? end.getTime() - start.getTime() : 0
  const maxDurationMs = allDay ? 14 * 86400000 : 16 * 3600000
  if (!end || durationMs < 5 * 60000 || durationMs > maxDurationMs) {
    end = new Date(start.getTime() + (allDay ? 24 : 60) * 3600000)
  }

  const data: Record<string, unknown> = { title, start, end, allDay }
  const location = strParam(params.location, 200)
  if (location) data.location = location
  const description = strParam(params.description, 2000)
  if (description) data.description = description

  // Same conflict rule as the calendar UI: never silently double-book.
  const conflicts = await detectConflicts(start, end)
  if (conflicts.length > 0) {
    const lines = conflicts.slice(0, 3).map((c) => `• ${c.title} — ${fmtDateTime(new Date(c.start), tz)}`)
    return {
      reply: `⚠️ I did not book that — the slot overlaps with:\n${lines.join('\n')}\nTell me another time and I will schedule it.`,
    }
  }

  const event = await createProd('event', data)

  const timeLine = allDay
    ? fmtDateTime(start, tz)
    : `${fmtDateTime(start, tz)} – ${fmtTime(end, tz)}`
  const lines = [`📅 Event scheduled — "${title}"`, timeLine]
  if (location) lines.push(`Location: ${location}`)
  lines.push('It is on your calendar now.')
  return { reply: lines.join('\n'), id: event.id, label: title }
}

async function buildSystemPrompt(tz: string, orgId: string, userId: string): Promise<string> {
  const now = new Date()
  const nowIso = now.toISOString()
  const todayHuman = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  const snapshot = await buildCrmSnapshot(orgId, userId, tz).catch(() => 'LIVE CRM DATA: temporarily unavailable — do not invent numbers.')
  return `You are Zia, a broad, general-purpose AI assistant embedded in the Unstop CRM platform.

You are NOT limited to CRM topics — you are a full assistant, like a top-tier AI chatbot, PLUS you have two CRM superpowers: you can see the user's live CRM data (snapshot below) and act on it.

WHAT YOU CAN ANSWER (anything, including):
- General knowledge, explanations and how-tos — science, tech, business, history, health literacy, everyday life
- Current events, prices, rankings, releases — anything that may have changed recently → use the web_search tool, then cite sources
- Business & sales strategy, playbooks, negotiation, marketing, hiring, finance
- Writing & editing: emails, proposals, posts, summaries, rewrites, translations
- Math, unit conversion, data analysis, comparisons, decision frameworks
- Code: write, explain, debug (fenced code blocks with a language tag)
- CRM analytics: the user's leads, pipeline, deals, win rate, CSM cadence, tasks, events, revenue — from LIVE CRM DATA
- Research synthesis: combine web_search results + CRM data into one answer

ANSWER STYLE (output-driven — every answer should be genuinely useful, structured and complete)
- Match depth to the question: small talk gets one line; real questions get a complete, well-organized answer.
- Use clean GitHub-flavored markdown: short headings (## …) when they aid scanning, bullet lists ("- ") for multi-point answers, **bold** for key figures, markdown tables for side-by-side comparisons, fenced code blocks WITH a language tag for code/formulas/queries.
- Short paragraphs (1–3 sentences). No walls of text. Prefer concrete examples over vague advice.
- **Bold** the key numbers. When an answer uses LIVE CRM DATA, quote those numbers EXACTLY as they appear below — never invent, estimate or round them.
- If information is missing (CRM or web), say so plainly and name what you would need instead of guessing.
- End longer answers (more than a couple of sentences) with a final "Next best actions:" list of at most 3 "• " bullets.

${snapshot}

CAPABILITIES (tools)
- web_search — live search of the public internet for news, facts, prices, competitors, anything outside the user's CRM
- search_records — read-only lookup of specific CRM records (people, companies, filtered lists)
- CREATE work on request: tasks / to-dos and calendar events / meetings

OUTPUT PROTOCOL (mandatory)
Always answer with exactly ONE JSON object and nothing else — no prose before or after.

Conversation answer:
{"reply": "<your helpful answer>"}

Action (when the user asks you to look something up, create / schedule / book / add something):
{"action": "<name>", "params": { ... }, "reply": "<short fallback line, used only if the action fails>"}

Available actions:
1. web_search — search the public web (use for current events, recent facts, anything the user's CRM cannot answer and your training data might be stale on, e.g. "latest AI news", "average SaaS conversion rate 2025", "Acme Corp funding")
   params: query (required string — good keywords, not a full sentence), num (1-8, optional, default 5), recency_days (optional number — set 7 for news, 30 for trends)
   After a web_search action you will receive a WEB_RESULTS user message. Summarize the findings in your own words and cite sources as markdown links ([title](URL)) in the reply. Never fabricate URLs or quotes.
2. create_task — also use for to-dos, follow-ups, reminders ("add a to-do…", "create a task…")
   params: title (required string), dueDate (ISO-8601 with timezone offset, optional), priority ("low"|"medium"|"high"|"urgent", optional, default medium), description (optional string), status ("not_started"|"in_progress", optional)
3. create_event — meetings, demos, appointments, calls to put on the calendar ("schedule…", "book…", "set up a meeting…")
   params: title (required string), start (ISO-8601 with timezone offset, required), end (ISO-8601, optional — defaults to 1 hour after start), location (optional string), description (optional string), allDay (optional boolean)
4. set_next_step — move a CONTACT forward in the sales CSM cadence ("set Day 3 Call for Priya", "move Rahul to Day 1 Reconnect", "mark the loop complete for Anita")
   params: contact (required string — the person's name, partial is fine), step (required, exactly one of: None, Day 0, Day 0 reconnect, Day 1 Reconnect, Day 3 Call, Day 3 Reconnect, Day 7, Day 14 Call, Old Lead, CSM Loop complete)
5. search_records — read-only lookup when the user asks about specific records, people, companies or filtered lists not covered by the snapshot ("find Priya's email", "show deals for Acme", "list hot leads", "my overdue tasks")
   params: module (required, one of: deal, lead, contact, account, task, event), q (free text — name/company/email, optional), stage (deal stage name, optional), status (lead or task status, optional), minAmount / maxAmount (numbers, deals only, optional), sort ("amount_desc"|"amount_asc"|"close_asc"|"recent", optional), limit (1-15, optional), includePast (boolean, events only, optional)
   After a search_records action you will receive a TOOL_RESULT user message — then answer using the conversation form based on that data.

Action format examples (the action name ALWAYS goes in "action", params in "params"):
{"action": "web_search", "params": {"query": "top CRM industry trends 2025", "num": 5, "recency_days": 30}}
{"action": "search_records", "params": {"module": "contact", "q": "Priya"}}
{"action": "create_task", "params": {"title": "Send proposal", "dueDate": "2026-10-28T11:00:00+05:30"}}
{"reply": "Your pipeline is ₹91,500 across 4 deals. Globally, …"}

Rules:
- BREADTH: answer ANY question on ANY topic. Never refuse or deflect to "I'm just a CRM assistant" — you are a full assistant. Only delegate to a tool when it genuinely improves the answer.
- WEB GROUNDING: whenever you use WEB_RESULTS, cite sources as markdown links and only state what the results support. If web_search fails or returns nothing, answer from your own knowledge and say it could not be verified online.
- NUMBERS: use ONLY figures from LIVE CRM DATA, TOOL_RESULT or WEB_RESULTS. Never invent, estimate or round beyond what the data shows. If a figure is not available, say what you would need. Zero means none yet.
- FORMATTING: write clean GitHub-flavored markdown for a chat bubble — the renderer supports headings, tables and code blocks. Keep it compact and scannable.
- Right now it is ${todayHuman}, ${nowIso} (ISO/UTC). User timezone: ${tz}. Convert relative times ("tomorrow 10am", "next Friday 3pm", "end of day") into exact ISO-8601 including the timezone offset. Double-check weekday and date arithmetic before answering.
- If a required detail is missing (no title AND no time for work items, no contact name for set_next_step), use the conversation form and ask one short clarifying question instead of guessing.
- Never invent actions beyond the five listed. Never put JSON inside the "reply" value.
- If you don't know something, say so.`
}

export async function chat(userMessage: string, timezone = 'UTC') {
  const { session, tenant } = await ctx()
  const tz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'UTC'
  const orgId = tenant.organization.id

  // Get or create conversation
  let conv = await db.ziaConversation.findFirst({
    where: { organizationId: orgId, userId: session.userId },
    orderBy: { updatedAt: 'desc' },
  })
  if (!conv) {
    conv = await db.ziaConversation.create({
      data: { organizationId: orgId, userId: session.userId, messages: '[]' },
    })
  }

  const history = JSON.parse(conv.messages || '[]') as { role: string; content: string }[]

  const baseMessages: ChatMessage[] = [
    { role: 'system', content: await buildSystemPrompt(tz, orgId, session.userId) },
    ...history.slice(-10).map((m) => ({ role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userMessage },
  ]

  // ReAct-style loop: the model may issue read-only tool calls (fed back as
  // TOOL_RESULT messages) before producing its final answer. search_records is
  // executed directly; an UNKNOWN action name gets a corrective error so the
  // model can retry with a valid action or reply straight away.
  let working = baseMessages
  let raw = ''
  let parsed: ParsedOutput = null
  // Real token accounting across all tool-loop iterations.
  let usageIn = 0
  let usageOut = 0
  let usageModel: string | undefined
  let usageKnown = false
  for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
    const { content, usage } = await callLLM(working)
    raw = content
    if (usage) {
      usageKnown = true
      usageIn += usage.inputTokens
      usageOut += usage.outputTokens
      if (usage.model) usageModel = usage.model
    }
    if (!raw) break
    parsed = parseModelOutput(raw)
    if (parsed?.kind !== 'action') break // reply (or salvageable output) — done
    if (KNOWN_ACTIONS.has(parsed.action)) break // mutating action — executed after the loop
    let toolResult: string
    if (parsed.action === SEARCH_ACTION) {
      try {
        toolResult = await searchCrmRecords(orgId, session.userId, parsed.params as SearchParams, tz)
      } catch (e) {
        toolResult = `ERROR: ${e instanceof Error ? e.message : 'The search could not be executed.'}`
      }
    } else if (parsed.action === WEB_SEARCH_ACTION) {
      try {
        toolResult = await runWebSearch(parsed.params)
      } catch (e) {
        toolResult = `ERROR: ${e instanceof Error ? e.message : 'The web search could not be executed.'}`
      }
    } else {
      toolResult = `ERROR: "${parsed.action}" is not an available action. To look up CRM data use {"action": "search_records", "params": {"module": "…"}}; for up-to-date public information use {"action": "web_search", "params": {"query": "…"}}; to make changes use create_task, create_event or set_next_step; otherwise answer directly with {"reply": "…"}.`
    }
    working = [
      ...working,
      { role: 'assistant', content: raw },
      { role: 'user', content: `TOOL_RESULT:\n${toolResult}\n\nNow answer the user's original question using this data. Respond with the single JSON object protocol.` },
    ]
  }

  let responseText = ''
  let action: { type: 'task' | 'event' | 'csm'; id: string; label: string } | undefined
  if (!raw) {
    responseText = 'I am having trouble connecting to the AI service right now. Please try again in a moment.'
  } else {
    if (parsed?.kind === 'action' && !KNOWN_ACTIONS.has(parsed.action)) {
      // Tool budget exhausted while the model still emitted a tool call (search
      // or unknown action) — salvage the fallback reply instead of erroring.
      responseText = parsed.reply?.trim() || 'I found some data but could not put the answer together. Could you rephrase that?'
    } else if (parsed?.kind === 'action' && KNOWN_ACTIONS.has(parsed.action)) {
      // The model requested an action — validate, execute, confirm.
      try {
        const result = parsed.action === 'create_event'
          ? await executeEventAction(parsed.params, tz)
          : parsed.action === 'set_next_step'
            ? await executeNextStepAction(parsed.params, tz)
            : await executeTaskAction(parsed.params, session.userId, tz)
        responseText = result.reply
        if (result.id) {
          action = {
            type: parsed.action === 'create_event' ? 'event' : parsed.action === 'set_next_step' ? 'csm' : 'task',
            id: result.id,
            label: result.label ?? '',
          }
        }
      } catch (e) {
        responseText = parsed.reply?.trim()
          || (e instanceof ActionError
            ? e.message
            : 'I understood the request but could not save it. Please try again.')
      }
    } else if (parsed?.kind === 'reply') {
      responseText = parsed.reply.trim() || 'Could you rephrase that for me?'
    } else if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
      // Model emitted unparseable JSON — never leak it to the chat.
      console.warn('[zia] unparseable model output:', raw.slice(0, 400))
      responseText = 'I could not process that request. Could you rephrase it?'
    } else {
      // Plain-prose fallback (model skipped the JSON protocol) — trim for clean bubbles.
      responseText = raw.trim()
    }
  }

  // Update conversation history (tool round-trips stay out of it — only the final answer is stored)
  history.push({ role: 'user', content: userMessage })
  history.push({ role: 'assistant', content: responseText })
  await db.ziaConversation.update({
    where: { id: conv.id },
    data: { messages: JSON.stringify(history) },
  })

  // Log cost — REAL token accounting when the provider reports usage, with a
  // documented price table ($ per 1M tokens, env-overridable). The previous
  // implementation logged a hardcoded cost of 0.001 and length/4 token
  // estimates, so every AI cost dashboard was fabricated.
  const PRICE_PER_1M_IN = Number(process.env.AI_PRICE_PER_1M_INPUT ?? '0.15')
  const PRICE_PER_1M_OUT = Number(process.env.AI_PRICE_PER_1M_OUTPUT ?? '0.60')
  const inputTokens = usageKnown ? usageIn : Math.ceil(JSON.stringify(working).length / 4)
  const outputTokens = usageKnown ? usageOut : Math.ceil(responseText.length / 4)
  const cost = (inputTokens / 1_000_000) * PRICE_PER_1M_IN + (outputTokens / 1_000_000) * PRICE_PER_1M_OUT
  await db.aICostLog.create({
    data: {
      organizationId: orgId,
      model: usageModel ?? 'glm',
      inputTokens,
      outputTokens,
      cost: Number(cost.toFixed(6)),
      taskType: 'chat',
    },
  })

  return { response: responseText, conversationId: conv.id, action }
}

export async function getChatHistory() {
  const { session, tenant } = await ctx()
  const conv = await db.ziaConversation.findFirst({
    where: { organizationId: tenant.organization.id, userId: session.userId },
    orderBy: { updatedAt: 'desc' },
  })
  if (!conv) return []
  return JSON.parse(conv.messages || '[]') as { role: string; content: string; timestamp?: string }[]
}

export async function clearChat() {
  const { session, tenant } = await ctx()
  await db.ziaConversation.updateMany({
    where: { organizationId: tenant.organization.id, userId: session.userId },
    data: { messages: '[]' },
  })
}

// ---------------------------------------------------------------------------
// Lead Scoring — heuristic
// ---------------------------------------------------------------------------

/** Parse a JSON-array column (emails/phones) safely — bad/missing data yields []. */
function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export interface LeadScoreFactor { key: string; label: string; points: number; note: string }

export interface LeadScoreResult {
  score: number
  /** Rich breakdown — one entry per heuristic that fired, with a human note. */
  factors: LeadScoreFactor[]
  /** Legacy numeric map (key → points) kept for backward compatibility. */
  factorPoints: Record<string, number>
  tier: 'hot' | 'warm' | 'cold'
  recommendation: string
}

export async function scoreLead(leadId: string): Promise<LeadScoreResult> {
  const { tenant } = await ctx()
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: tenant.organization.id } })
  if (!lead) throw new Error('Lead not found')

  const factorPoints: Record<string, number> = {}
  const factors: LeadScoreFactor[] = []
  const add = (key: string, label: string, points: number, note: string) => {
    factorPoints[key] = points
    factors.push({ key, label, points, note })
  }

  let score = 0
  if (parseJsonArray(lead.emails).length > 0) { score += 20; add('has_email', 'Has email', 20, 'Has a verified email address on file (+20)') }
  if (parseJsonArray(lead.phones).length > 0) { score += 15; add('has_phone', 'Has phone', 15, 'A direct phone number is available for outreach (+15)') }
  if (lead.company) { score += 15; add('has_company', 'Company known', 15, `Affiliated with ${lead.company} (+15)`) }
  if (lead.annualRevenue && lead.annualRevenue > 1000000) { score += 25; add('high_revenue', 'High revenue', 25, 'Annual revenue exceeds ₹1M — larger budget potential (+25)') }
  if (lead.leadSource === 'Referral') { score += 15; add('referral_source', 'Referral', 15, 'Came in through a referral — warmer first conversation (+15)') }
  if (lead.rating === 'hot') { score += 10; add('hot_rating', 'Hot rating', 10, 'Manually rated hot by the team (+10)') }
  if (lead.industry) { score += 5; add('has_industry', 'Industry known', 5, `Industry on record (${lead.industry}) enables targeted messaging (+5)`) }

  score = Math.min(score, 100)

  const tier: LeadScoreResult['tier'] = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold'
  const name = `${lead.firstName} ${lead.lastName}`.trim()
  let recommendation: string
  if (tier === 'hot') {
    recommendation = `Call ${name} today — a lead this warm cools off fast. Reference ${lead.company ?? 'their company'}${lead.industry ? ` and their position in ${lead.industry}` : ''} in the opening line, then aim to book a demo or send a proposal before the week ends.`
  } else if (tier === 'warm') {
    recommendation = `Put ${name} on a short nurture plan: send a tailored value email this week, follow up after 3 days with a relevant case study, then offer a 15-minute discovery call to keep momentum.`
  } else {
    recommendation = `${name} is a long-cycle lead — keep them on a low-touch monthly cadence (newsletter or occasional check-in) and prioritise leads with richer profiles. Re-score after any new activity or contact data arrives.`
  }

  // Persist the rich breakdown in the existing JSON text column. The legacy
  // numeric map is kept under `points` so any reader of the old shape keeps
  // working; `detail` carries the new per-heuristic notes.
  const persistedFactors = JSON.stringify({ points: factorPoints, detail: factors, tier, recommendation })

  const existing = await db.leadScore.findUnique({
    where: { organizationId_leadId: { organizationId: tenant.organization.id, leadId } },
  })
  if (existing) {
    await db.leadScore.update({
      where: { id: existing.id },
      data: { score, factors: persistedFactors, calculatedAt: new Date() },
    })
  } else {
    await db.leadScore.create({
      data: { organizationId: tenant.organization.id, leadId, score, factors: persistedFactors },
    })
  }

  return { score, factors, factorPoints, tier, recommendation }
}

// ---------------------------------------------------------------------------
// Smart Suggestions
// ---------------------------------------------------------------------------

export async function generateSuggestions() {
  const { session, tenant } = await ctx()
  const orgId = tenant.organization.id
  const suggestions: {
    suggestionType: string; title: string; description: string;
    /** 1-2 sentences on why this matters — returned by the API, not persisted (no column). */
    detail: string
    /** 2-4 concrete actions the user can take. */
    steps: string[]
    targetModule: string; targetId: string; priority: number;
  }[] = []

  // 1. Leads not contacted in 7+ days
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000)
  const staleLeads = await db.lead.findMany({
    where: { organizationId: orgId, deletedAt: null, lastActivity: { lt: sevenDaysAgo }, leadStatus: { not: 'converted' } },
    take: 3,
    select: { id: true, firstName: true, lastName: true, company: true },
  })
  for (const lead of staleLeads) {
    suggestions.push({
      suggestionType: 'next_best_action', title: `Follow up with ${lead.firstName} ${lead.lastName}`,
      description: `Lead from ${lead.company ?? 'unknown'} hasn't been contacted in 7+ days. Send a follow-up email.`,
      detail: 'Leads that go quiet for a week convert far less often — a short, personal nudge now keeps the conversation warm before it goes cold.',
      steps: [
        'Open the lead and check the timeline for the last touchpoint',
        `Send a short follow-up email referencing ${lead.company ?? 'their company'} and the last conversation`,
        'If no reply within 3 days, call them or move them to a Day 3 cadence step',
      ],
      targetModule: 'lead', targetId: lead.id, priority: 80,
    })
  }

  // 2. Deals stuck in stage too long
  const stuckDeals = await db.deal.findMany({
    where: { organizationId: orgId, deletedAt: null, closeDate: { lt: new Date() } },
    take: 3,
    select: { id: true, name: true, amount: true, closeDate: true, stage: { select: { name: true, isClosed: true } } },
  })
  for (const deal of stuckDeals) {
    if (!deal.stage?.isClosed) {
      suggestions.push({
        suggestionType: 'next_best_action', title: `Update close date for "${deal.name}"`,
        description: `Deal close date has passed but deal is still open (stage: ${deal.stage?.name}). Update the close date or move to won/lost.`,
        detail: 'A deal past its close date skews your forecast and hides real slippage — either the date is stale or the deal is quietly stuck.',
        steps: [
          'Confirm the real next milestone with your contact on the deal',
          'Update the close date to a realistic new target',
          'If it is no longer winnable, mark it lost so the pipeline stays honest',
        ],
        targetModule: 'deal', targetId: deal.id, priority: 90,
      })
    }
  }

  // 3. Deals with only 1 contact
  const dealsWithOneContact = await db.deal.findMany({
    where: { organizationId: orgId, deletedAt: null, stage: { isClosed: false } },
    take: 3,
    select: { id: true, name: true, _count: { select: { dealContacts: true } } },
  })
  for (const deal of dealsWithOneContact) {
    if (deal._count.dealContacts <= 1) {
      suggestions.push({
        suggestionType: 'next_best_action', title: `Add decision maker to "${deal.name}"`,
        description: `This deal has only ${deal._count.dealContacts} contact. Consider adding a decision maker to increase win probability.`,
        detail: 'Single-threaded deals are fragile — if that one contact goes quiet or leaves, the deal stalls with no backup path.',
        steps: [
          'Ask your current contact who else owns the budget or the rollout',
          'Add that decision maker to the deal',
          'Book a joint call so both stakeholders hear the same pitch',
        ],
        targetModule: 'deal', targetId: deal.id, priority: 60,
      })
    }
  }

  // Save suggestions one-by-one so each row's id comes back — the freshly
  // generated list (including detail/steps) can be rendered and dismissed
  // without a follow-up GET (whose rows have no detail/steps columns).
  const created: (typeof suggestions[number] & { id: string })[] = []
  for (const s of suggestions) {
    const row = await db.smartSuggestion.create({
      data: {
        organizationId: orgId,
        userId: session.userId,
        suggestionType: s.suggestionType,
        title: s.title,
        description: s.description,
        targetModule: s.targetModule,
        targetId: s.targetId,
        priority: s.priority,
      },
    })
    created.push({ ...s, id: row.id })
  }

  return created
}

export async function getSuggestions() {
  const { session, tenant } = await ctx()
  return db.smartSuggestion.findMany({
    where: { organizationId: tenant.organization.id, userId: session.userId, isDismissed: false },
    orderBy: { priority: 'desc' },
    take: 10,
  })
}

export async function dismissSuggestion(id: string) {
  const { tenant } = await ctx()
  await db.smartSuggestion.updateMany({
    where: { id, organizationId: tenant.organization.id },
    data: { isDismissed: true },
  })
}

// ---------------------------------------------------------------------------
// Ask AI (nlp-query) — BROAD, output-driven single-shot assistant
// ---------------------------------------------------------------------------

/** Read-only tool round-trips allowed for Ask AI (latency guard, same idea as chat). */
const ASK_MAX_TOOL_ITERATIONS = 3

/**
 * System prompt for the AI Center's Ask AI box. Deliberately BROAD — the box
 * answers anything (knowledge, research, strategy, writing, code) in addition
 * to CRM analytics — and OUTPUT-DRIVEN: answers lead with the conclusion and
 * arrive structured (headings, bullets, tables, ready-to-use drafts/code).
 */
function buildAskSystemPrompt(tz: string, snapshot: string): string {
  const now = new Date()
  const nowIso = now.toISOString()
  const todayHuman = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
  return `You are Zia, the "Ask AI" assistant in the AI Center of the Unstop CRM platform — a BROAD, general-purpose, OUTPUT-DRIVEN assistant.

You are NOT limited to CRM topics. Answer ANY question well — then go one step further and make the answer immediately usable.

WHAT YOU CAN ANSWER (anything, including):
- General knowledge, explanations and how-tos — science, tech, business, history, health literacy, everyday life
- Current events, prices, rankings, releases — anything that may have changed recently → use the web_search tool first, then cite sources
- Business & sales strategy, playbooks, negotiation, marketing, hiring, finance, market sizing
- Writing & editing: emails, proposals, posts, summaries, rewrites, translations — deliver full, ready-to-use text
- Math, unit conversion, data analysis, comparisons, decision frameworks
- Code: write, explain, debug (fenced code blocks with a language tag)
- CRM analytics: the user's leads, pipeline, deals, win rate, CSM cadence, tasks, events — from LIVE CRM DATA
- Research synthesis: combine web_search results + CRM data into one answer

OUTPUT-DRIVEN STYLE (what makes Ask AI excellent):
- Lead with the answer. First line = the conclusion or headline number, never filler.
- Structure for scanning: short paragraphs (1–3 sentences), "## " headings when the answer has distinct parts, "- " bullets for lists, **bold** for key figures, markdown tables for side-by-side comparisons, fenced code blocks WITH a language tag for code/formulas/queries.
- Make it usable: when the question implies action, include concrete next steps, ready-to-send drafts (full text), ready-to-run snippets, or a clear recommendation with reasoning — not vague advice.
- Match depth to the question: small talk gets one line; real questions get complete, well-organized answers.
- When an answer uses LIVE CRM DATA, quote those numbers EXACTLY as they appear below — never invent, estimate or round them.
- If information is missing (CRM or web), say so plainly and name what you would need instead of guessing.
- End substantive answers with a short "Next best actions:" list of at most 3 "• " bullets.

${snapshot}

TOOLS
- web_search — live search of the public internet (news, facts, prices, competitors, anything outside the CRM)
- search_records — read-only lookup of specific CRM records (people, companies, filtered lists not covered by the snapshot above)

PROTOCOL
Always answer with exactly ONE JSON object and nothing else — no prose before or after.
- Conversation answer: {"reply": "<your markdown answer>"}
- Tool call: {"action": "<name>", "params": { ... }, "reply": "<short fallback line, used only if the tool fails>"}
  - web_search params: query (required — good keywords, not a full sentence), num (1-8, optional, default 5), recency_days (optional — 7 for news, 30 for trends)
  - search_records params: module (required, one of: deal, lead, contact, account, task, event), q (optional free text — name/company/email), stage (deal stage, optional), status (lead or task status, optional), minAmount / maxAmount (numbers, deals only), sort ("amount_desc"|"amount_asc"|"close_asc"|"recent", optional), limit (1-15, optional), includePast (boolean, events only)
- After a tool call you receive a TOOL_RESULT user message — then answer with the conversation form based on that data. After WEB_RESULTS, cite sources as markdown links ([title](URL)) and only state what they support; never fabricate URLs.

Rules:
- BREADTH: answer ANY question on ANY topic. Never refuse or deflect with "I'm only a CRM assistant". Delegate to a tool only when it genuinely improves the answer.
- NUMBERS: use ONLY figures from LIVE CRM DATA, TOOL_RESULT or WEB_RESULTS. Never invent or round beyond what the data shows. Zero means none yet.
- Right now it is ${todayHuman}, ${nowIso} (ISO/UTC). User timezone: ${tz}. Convert relative times ("tomorrow", "this week") into exact dates; double-check weekday and date arithmetic.
- Never put JSON inside the "reply" value. If you don't know something, say so.`
}

/**
 * Ask AI — the AI Center's single-shot question box. Broad like the Zia
 * chatbot (general knowledge + live web search) but grounded in the same live
 * CRM snapshot, and tuned for output-driven answers: the model may run
 * read-only tools (search_records / web_search) before producing one final
 * structured markdown answer. The prior keyword-matcher only answered four
 * hardcoded CRM phrasings and dumped raw JSON rows — everything now flows
 * through this one broad path so every answer is complete and formatted.
 */
export async function nlpQuery(question: string, timezone = 'UTC') {
  const { session, tenant } = await ctx()
  const orgId = tenant.organization.id
  const tz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'UTC'

  let summary = ''
  try {
    const snapshot = await buildCrmSnapshot(orgId, session.userId, tz)
      .catch(() => 'LIVE CRM DATA: temporarily unavailable — do not invent numbers.')
    const baseMessages: ChatMessage[] = [
      { role: 'system', content: buildAskSystemPrompt(tz, snapshot) },
      { role: 'user', content: question },
    ]

    // ReAct-style read-only tool loop using the same primitives as the Zia
    // chatbot — search_records for CRM lookups, web_search for the open web.
    let working = baseMessages
    let raw = ''
    let parsed: ParsedOutput = null
    for (let i = 0; i <= ASK_MAX_TOOL_ITERATIONS; i++) {
      const { content } = await callLLM(working)
      raw = content
      if (!raw) break
      parsed = parseModelOutput(raw)
      if (parsed?.kind !== 'action') break // reply (or salvageable output) — done
      let toolResult: string
      if (parsed.action === SEARCH_ACTION) {
        try {
          toolResult = await searchCrmRecords(orgId, session.userId, parsed.params as SearchParams, tz)
        } catch (e) {
          toolResult = `ERROR: ${e instanceof Error ? e.message : 'The search could not be executed.'}`
        }
      } else if (parsed.action === WEB_SEARCH_ACTION) {
        try {
          toolResult = await runWebSearch(parsed.params)
        } catch (e) {
          toolResult = `ERROR: ${e instanceof Error ? e.message : 'The web search could not be executed.'}`
        }
      } else {
        toolResult = `ERROR: "${parsed.action}" is not available here. Use search_records or web_search, or answer directly with {"reply": "…"}.`
      }
      working = [
        ...working,
        { role: 'assistant', content: raw },
        { role: 'user', content: `TOOL_RESULT:\n${toolResult}\n\nNow answer the user's original question using this data. Respond with the single JSON object protocol.` },
      ]
    }

    if (!raw) {
      summary = 'I could not reach the AI service just now. Please try again in a moment.'
    } else if (parsed?.kind === 'reply') {
      summary = parsed.reply.trim() || 'Could you rephrase that?'
    } else if (parsed?.kind === 'action') {
      // Tool budget exhausted while the model still emitted a tool call —
      // salvage the fallback reply instead of erroring.
      summary = parsed.reply?.trim() || 'I gathered some data but could not assemble the answer. Please rephrase.'
    } else if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
      // Model emitted unparseable JSON — never leak it to the UI.
      console.warn('[ask-ai] unparseable model output:', raw.slice(0, 400))
      summary = 'I could not process that question. Could you rephrase it?'
    } else {
      // Plain-prose fallback (model skipped the JSON protocol).
      summary = raw.trim()
    }
  } catch {
    summary = 'I could not process that question. Please try rephrasing.'
  }

  // Log the query
  await db.nLPQuery.create({
    data: {
      organizationId: orgId,
      userId: session.userId,
      question,
      generatedSpec: JSON.stringify({ type: 'nlp', question }),
      resultSummary: summary.slice(0, 2000),
    },
  })

  return { query: question, summary, results: [] }
}

// ---------------------------------------------------------------------------
// AI Writer
// ---------------------------------------------------------------------------

export async function generateEmail(prompt: string, style = 'professional', tone = 'friendly') {
  const { session, tenant } = await ctx()
  let content = ''
  let subject: string | undefined
  let alternatives: string[] | undefined
  try {
    const zai = await getZAI()
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are an AI email writer for a CRM platform. Write a ${style} ${tone} email based on the user's request.\nRespond with exactly ONE JSON object and nothing else — no prose before or after:\n{"subject": "<subject line, max 60 characters, specific and concrete>", "alternatives": ["<alternative subject 1, max 60 chars>", "<alternative subject 2, max 60 chars>"], "body": "<plain-text email body>"}\nBody structure: a personalized greeting (use any name, company or context found in the request), a value hook that references that record context, the core message, ONE single clear call to action, and a short sign-off. Keep the body concise and professional.`,
        },
        { role: 'user', content: prompt },
      ],
      thinking: { type: 'disabled' },
    })
    const raw = completion.choices[0]?.message?.content ?? ''
    const parsed = extractJson(raw)
    const bodyText = typeof parsed?.body === 'string' ? parsed.body.trim() : ''
    if (parsed && bodyText) {
      subject = typeof parsed.subject === 'string' && parsed.subject.trim() ? parsed.subject.trim().slice(0, 120) : undefined
      const altList = Array.isArray(parsed.alternatives)
        ? parsed.alternatives.filter((a): a is string => typeof a === 'string' && a.trim().length > 0).map((a) => a.trim().slice(0, 120)).slice(0, 2)
        : []
      if (altList.length > 0) alternatives = altList
      // Persisted content keeps the same readable "Subject: …\n\n<body>" text
      // shape as before — alternatives live only in the API response.
      content = subject ? `Subject: ${subject}\n\n${bodyText}` : bodyText
    } else {
      content = raw
    }
  } catch {
    content = 'Unable to generate email at this time. Please try again.'
  }

  const draft = await db.aIWriterDraft.create({
    data: {
      organizationId: tenant.organization.id,
      userId: session.userId,
      draftType: 'email',
      prompt,
      generatedContent: content,
      style, tone,
    },
  })

  // Additive response fields (subject/alternatives) — persistence unchanged.
  return { id: draft.id, content, ...(subject ? { subject } : {}), ...(alternatives ? { alternatives } : {}) }
}

// ---------------------------------------------------------------------------
// Anomalies
// ---------------------------------------------------------------------------

export async function listAnomalies() {
  const { tenant } = await ctx()
  return db.anomaly.findMany({
    where: { organizationId: tenant.organization.id, status: 'open' },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    take: 20,
  })
}

export async function acknowledgeAnomaly(id: string) {
  const { session, tenant } = await ctx()
  await db.anomaly.updateMany({
    where: { id, organizationId: tenant.organization.id },
    data: { status: 'acknowledged', acknowledgedById: session.userId, acknowledgedAt: new Date() },
  })
}

/**
 * Rule-based anomaly scan — the only writer of Anomaly rows, so the Anomalies
 * tab actually has data. Rules (Anomaly model: recordType/recordId/anomalyType/
 * severity/description, status 'open' until acknowledged):
 *  - stale_hot_lead:    hot/warm lead, not converted, no activity for 14+ days
 *  - overdue_deal:      open deal whose close date has passed
 *  - overdue_followup:  contact cadence follow-up more than 3 days overdue
 * Dedupe: skips records that already have an unacknowledged anomaly of the
 * same type; capped at 25 inserts per scan. Returns the number created.
 */
export async function scanAnomalies() {
  const { tenant } = await ctx()
  const orgId = tenant.organization.id
  const now = new Date()
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000)
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400000)
  const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const [staleLeads, overdueDeals, overdueFollowups, existingOpen] = await Promise.all([
    db.lead.findMany({
      where: {
        organizationId: orgId, deletedAt: null, isConverted: false,
        rating: { in: ['hot', 'warm'] }, lastActivity: { lt: fourteenDaysAgo },
      },
      select: { id: true, firstName: true, lastName: true, company: true, rating: true, lastActivity: true },
      take: 40,
    }),
    db.deal.findMany({
      where: { organizationId: orgId, deletedAt: null, closeDate: { lt: now }, stage: { isClosed: false } },
      select: { id: true, name: true, closeDate: true },
      take: 40,
    }),
    db.contact.findMany({
      where: { organizationId: orgId, deletedAt: null, csmNextStepDueAt: { lt: threeDaysAgo } },
      select: { id: true, firstName: true, lastName: true, csmNextStep: true, csmNextStepDueAt: true },
      take: 40,
    }),
    // Dedupe source: every still-open (unacknowledged) anomaly of this org.
    db.anomaly.findMany({
      where: { organizationId: orgId, status: 'open' },
      select: { anomalyType: true, recordId: true },
    }),
  ])

  const seen = new Set(existingOpen.map((a) => `${a.anomalyType}:${a.recordId}`))
  const candidates: { recordType: string; recordId: string; anomalyType: string; severity: string; description: string }[] = []
  const push = (c: (typeof candidates)[number]) => {
    const key = `${c.anomalyType}:${c.recordId}`
    if (!seen.has(key)) { seen.add(key); candidates.push(c) }
  }

  for (const l of staleLeads) {
    push({
      recordType: 'lead', recordId: l.id, anomalyType: 'stale_hot_lead',
      severity: l.rating === 'hot' ? 'high' : 'medium',
      description: `${l.firstName} ${l.lastName}${l.company ? ` (${l.company})` : ''} is a ${l.rating}-rated lead with no activity since ${fmtDay(new Date(l.lastActivity))} — 14+ days quiet and not converted.`,
    })
  }
  for (const d of overdueDeals) {
    push({
      recordType: 'deal', recordId: d.id, anomalyType: 'overdue_deal', severity: 'high',
      description: `"${d.name}" is still open but its close date (${fmtDay(new Date(d.closeDate!))}) has passed — update the close date or move it to won/lost.`,
    })
  }
  for (const c of overdueFollowups) {
    push({
      recordType: 'contact', recordId: c.id, anomalyType: 'overdue_followup', severity: 'medium',
      description: `${c.firstName} ${c.lastName}'s cadence follow-up (${c.csmNextStep || 'next step'}) was due ${fmtDay(new Date(c.csmNextStepDueAt!))} and is more than 3 days overdue.`,
    })
  }

  const toCreate = candidates.slice(0, 25) // cap per scan
  if (toCreate.length > 0) {
    await db.anomaly.createMany({ data: toCreate.map((a) => ({ organizationId: orgId, ...a })) })
  }
  return toCreate.length
}

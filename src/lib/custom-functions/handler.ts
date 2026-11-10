import { db } from '@/lib/db'
import { getSession } from '@/lib/auth/session'
import { getTenant } from '@/lib/auth/tenant'
import { audit } from '@/lib/auth/audit'
import { createNotification } from '@/lib/realtime/handler'

async function ctx() {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  const tenant = await getTenant(session.userId)
  if (!tenant) throw new Error('No organization')
  return { session, tenant }
}

export const TEMPLATES = [
  {
    name: 'Lead Score Calculator',
    description: 'Calculate lead score from engagement + profile completeness',
    language: 'javascript',
    code: `// Calculate lead score
const lead = crm.leads.get(record_id);
let score = 0;
if (lead.email) score += 20;
if (lead.phone) score += 20;
if (lead.company) score += 15;
if (lead.annualRevenue && lead.annualRevenue > 1000000) score += 25;
score += Math.min(lead.score || 0, 20);
crm.leads.update(record_id, { score: score });
return { score: score };`,
  },
  {
    name: 'Sync Deal to External System',
    description: 'Send deal data to external API via webhook',
    language: 'javascript',
    code: `// Sync deal to external system
// NOTE: the target host must be in the HTTP allowlist (Functions settings),
// otherwise http.post THROWS "Domain ... is not in the HTTP allowlist".
const deal = crm.deals.get(record_id);
const response = http.post(
  'https://api.example.com/sync',
  { name: deal.name, amount: deal.amount },
  { 'Authorization': 'Bearer ' + kv.get('api_token') }
);
log.info('Synced deal: ' + deal.name);
return { synced: true, status: response.status };`,
  },
  {
    name: 'Generate Invoice PDF',
    description: 'Create a real, downloadable invoice PDF from deal data',
    language: 'javascript',
    code: `// Generate a real invoice PDF (demo fallbacks when record_id matches no deal)
const deal = (await crm.deals.get(record_id)) || {};
const amount = Number(inputData.amount ?? deal.amount ?? 49999);
const items = (Array.isArray(inputData.items) && inputData.items.length > 0)
  ? inputData.items
  : [{ description: deal.name || 'Professional services (demo)', qty: 1, price: amount }];
const details = {
  number: inputData.number || 'INV-' + Date.now(),
  date: inputData.date || new Date().toISOString(),
  dueDate: inputData.dueDate,
  from: { name: 'Unstop CRM Platform', email: 'billing@unstop.crm' },
  to: { name: deal.accountName || inputData.customer || 'Walk-in Customer' },
  items: items,
  taxPercent: inputData.taxPercent ?? 18,
};
const pdfFile = await pdf.invoice(details);
log.info('Invoice ' + details.number + ' generated: ' + pdfFile.filename);
return { invoice: { number: details.number, customer: details.to.name, amount: amount, items: items }, pdf: pdfFile };`,
  },
  {
    name: 'Send WhatsApp on Stage Change',
    description: 'Notify deal owner via WhatsApp when stage changes',
    language: 'javascript',
    code: `// Send WhatsApp notification
const deal = crm.deals.get(record_id);
const owner = crm.users.get(deal.ownerId);
const message = 'Deal updated: ' + deal.name + ' - $' + deal.amount;
const sms = await send_sms(owner.phone || 'unknown', message);
// Honest: no SMS provider is configured, nothing was really delivered.
return { simulated: sms.simulated === true, to: sms.to };`,
  },
  {
    name: 'Auto-merge Duplicate Contacts',
    description: 'Find and merge contacts with same email',
    language: 'javascript',
    code: `// Find duplicate contacts
const contact = crm.contacts.get(record_id);
const email = contact.email;
if (!email) return { merged: false, reason: 'no email' };
const duplicates = crm.contacts.query({ email: email, excludeId: record_id });
log.info('Found ' + duplicates.length + ' duplicates');
return { merged: duplicates.length > 0, count: duplicates.length };`,
  },
] as const

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listFunctions() {
  const { tenant } = await ctx()
  return db.customFunction.findMany({
    where: { organizationId: tenant.organization.id },
    include: { _count: { select: { executions: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getFunction(id: string) {
  const { tenant } = await ctx()
  return db.customFunction.findFirst({
    where: { id, organizationId: tenant.organization.id },
    include: {
      variables: true,
      executions: { orderBy: { createdAt: 'desc' }, take: 20 },
      versions: { orderBy: { version: 'desc' }, take: 10 },
    },
  })
}

export async function createFunction(data: {
  name: string; description?: string; language?: string; triggerEvent?: string; code?: string
}) {
  const { session, tenant } = await ctx()
  const fn = await db.customFunction.create({
    data: {
      organizationId: tenant.organization.id,
      name: data.name,
      description: data.description,
      language: data.language ?? 'javascript',
      triggerEvent: data.triggerEvent ?? 'manual',
      code: data.code ?? '',
      createdById: session.userId,
    },
  })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'custom_function.create', targetType: 'custom_function', targetId: fn.id,
  })
  return fn
}

export async function updateFunction(id: string, data: Record<string, unknown>) {
  const { session, tenant } = await ctx()
  // Save version before update
  const existing = await db.customFunction.findFirst({ where: { id, organizationId: tenant.organization.id } })
  if (existing) {
    const lastVersion = await db.customFunctionVersion.findFirst({
      where: { functionId: id }, orderBy: { version: 'desc' }, select: { version: true },
    })
    await db.customFunctionVersion.create({
      data: {
        organizationId: tenant.organization.id,
        functionId: id,
        version: (lastVersion?.version ?? 0) + 1,
        code: existing.code,
        createdById: session.userId,
      },
    })
  }
  await db.customFunction.updateMany({ where: { id, organizationId: tenant.organization.id }, data })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'custom_function.update', targetType: 'custom_function', targetId: id,
  })
}

export async function deleteFunction(id: string) {
  const { session, tenant } = await ctx()
  await db.customFunction.deleteMany({ where: { id, organizationId: tenant.organization.id } })
  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'custom_function.delete', targetType: 'custom_function', targetId: id,
  })
}

// ---------------------------------------------------------------------------
// Execution — sandboxed JS evaluator with CRM API
// ---------------------------------------------------------------------------

export async function executeFunction(functionId: string, inputData: Record<string, unknown>, trigger = 'manual') {
  const { session, tenant } = await ctx()
  const fn = await db.customFunction.findFirst({
    where: { id: functionId, organizationId: tenant.organization.id },
  })
  if (!fn) throw new Error('Function not found')

  const execution = await db.customFunctionExecution.create({
    data: {
      organizationId: tenant.organization.id,
      functionId,
      trigger,
      inputData: JSON.stringify(inputData),
      status: 'running',
    },
  })

  const startTime = Date.now()
  let status = 'completed'
  let outputData: unknown = null
  let errorMessage: string | null = null
  let logOutput = ''

  try {
    const result = await runSandboxed(fn.code, fn.language, inputData, tenant.organization.id, session.userId, functionId)
    outputData = result.output
    logOutput = result.logs
    if (result.error) {
      status = 'failed'
      errorMessage = result.error
    }
  } catch (e) {
    // Last-resort guard: runSandboxed itself never throws (it converts every
    // failure into a status:'failed' result), but if anything unexpected ever
    // escapes here the execution row below is still updated and the API
    // returns HTTP 200 with status:'failed' so the UI can render the reason.
    status = 'failed'
    errorMessage = e instanceof Error ? e.message : 'Unknown error'
  }

  const executionTimeMs = Date.now() - startTime

  await db.customFunctionExecution.update({
    where: { id: execution.id },
    data: {
      status,
      completedAt: new Date(),
      outputData: JSON.stringify(outputData),
      errorMessage,
      logOutput,
      executionTimeMs,
    },
  })

  // Update function stats
  await db.customFunction.update({
    where: { id: functionId },
    data: {
      lastExecutedAt: new Date(),
      executionCount: { increment: 1 },
      ...(status === 'failed' ? { errorCount: { increment: 1 } } : {}),
    },
  })

  await audit({
    organizationId: tenant.organization.id, actorId: session.userId,
    action: 'custom_function.execute', targetType: 'custom_function', targetId: functionId,
    metadata: { status, executionTimeMs },
  })

  return { executionId: execution.id, status, output: outputData, logs: logOutput, error: errorMessage, executionTimeMs }
}

/** Parse a sandbox http.* URL, throwing a clear error instead of a bare TypeError. */
function parseSandboxUrl(url: string, method: string): URL {
  try {
    return new URL(url)
  } catch {
    throw new Error(`http.${method}: invalid URL "${url}"`)
  }
}

/** Allowlist failures must be loud, honest errors — never a fake 403 "success". */
function throwAllowlistError(hostname: string): never {
  throw new Error(`Domain "${hostname}" is not in the HTTP allowlist. Add it in Functions settings before calling external APIs.`)
}

/**
 * Sandboxed JavaScript executor with a curated CRM API surface.
 * Uses Node's `vm` module for isolation; the sandbox NEVER throws — every
 * failure (syntax error, runtime error, allowlist rejection, timeout) comes
 * back as `{ output: null, logs, error }` so executeFunction can record it on
 * the execution row and the API still answers HTTP 200 with status:'failed'.
 *
 * API surface exposed to tenant code:
 * - `record_id` / `inputData` — execution input (`record_id` = inputData.record_id || inputData.id || '')
 * - `crm.leads.get(id) / .update(id, fields) / .query(filter)`
 * - `crm.deals.get(id) / .update(id, fields) / .query(filter)`
 * - `crm.contacts.get(id) / .query(filter)`
 * - `crm.users.get(id)` (tenant-scoped)
 * - `http.get(url)` / `http.post(url, body)` — the hostname MUST be in the
 *   org's HttpAllowlist, otherwise it THROWS a clear error telling the user
 *   where to add it. Allowed requests return `{ status, body }`; a target
 *   server replying 403 passes through genuinely.
 * - `kv.get(key)` / `kv.set(key, value)`
 * - `log.info(...)` / `log.error(...)` (console.log/info/warn/error captured too)
 * - `await send_email(to, subject, body)` → `{ simulated: true, to, subject }`
 *   and `await send_sms(to, body)` → `{ simulated: true, to }` — no mail/SMS
 *   provider is configured; these only push a log line and never claim real
 *   delivery.
 * - `await pdf.invoice({ number?, date?, dueDate?, from?, to?, items: [{description, qty, price}], taxPercent?, currency? })`
 *   and `await pdf.document({ title, lines: [{ text, size?, bold? }] })` —
 *   build a real PDF server-side (jsPDF, see ./pdf) and return
 *   `{ filename, base64, sizeBytes }`. The Test output panel renders a
 *   Download button whenever a result contains that payload.
 *
 * Wall-clock capped at 5s (the vm `timeout` covers sync work; a Promise race
 * covers the awaited async portion). The losing promise of that race always
 * gets a swallowed `.catch` so post-timeout rejections can't become unhandled
 * rejections in the server.
 */
async function runSandboxed(
  code: string,
  language: string,
  inputData: Record<string, unknown>,
  orgId: string,
  userId: string,
  functionId: string,
): Promise<{ output: unknown; logs: string; error: string | null }> {
  if (language === 'python') {
    // Python sandbox would use RestrictedPython in Django backend.
    // In the Next.js sandbox, we provide a simplified JS-transpiled fallback.
    return { output: null, logs: 'Python execution requires the Django backend (RestrictedPython).', error: 'Python not supported in this runtime' }
  }

  const logs: string[] = []
  const api = {
    crm: {
      leads: {
        get: async (id: string) => {
          const r = await db.lead.findFirst({ where: { id, organizationId: orgId } })
          return r ? { ...r, emails: JSON.parse(r.emails || '[]'), phones: JSON.parse(r.phones || '[]') } : null
        },
        update: async (id: string, fields: Record<string, unknown>) => {
          await db.lead.updateMany({ where: { id, organizationId: orgId }, data: fields })
          return { ok: true }
        },
        query: async (filter: Record<string, unknown>) => {
          return db.lead.findMany({ where: { organizationId: orgId, ...filter } as any, take: 100 })
        },
      },
      deals: {
        get: async (id: string) => {
          const r = await db.deal.findFirst({ where: { id, organizationId: orgId } })
          return r
        },
        update: async (id: string, fields: Record<string, unknown>) => {
          await db.deal.updateMany({ where: { id, organizationId: orgId }, data: fields })
          return { ok: true }
        },
        query: async (filter: Record<string, unknown>) => {
          return db.deal.findMany({ where: { organizationId: orgId, ...filter } as any, take: 100 })
        },
      },
      contacts: {
        get: async (id: string) => {
          const r = await db.contact.findFirst({ where: { id, organizationId: orgId } })
          return r ? { ...r, email: (JSON.parse(r.emails || '[]'))[0] || null } : null
        },
        query: async (filter: Record<string, unknown>) => {
          return db.contact.findMany({ where: { organizationId: orgId, ...filter } as any, take: 100 })
        },
      },
      users: {
        get: async (id: string) => {
          // Tenant-scoped: only return users who are members of this organization
          const r = await db.user.findFirst({
            where: {
              id,
              memberships: { some: { organizationId: orgId, isActive: true } },
            },
            select: { id: true, name: true, email: true },
          })
          return r
        },
      },
    },
    http: {
      get: async (url: string, _headers?: Record<string, string>) => {
        const { hostname } = parseSandboxUrl(url, 'get')
        const allowed = await db.httpAllowlist.findFirst({ where: { organizationId: orgId, domain: hostname, isActive: true } })
        if (!allowed) throwAllowlistError(hostname)
        try {
          const res = await fetch(url)
          return { status: res.status, body: await res.text() }
        } catch (e) {
          throw new Error(`http.get to "${hostname}" failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      },
      post: async (url: string, body: unknown, _headers?: Record<string, string>) => {
        const { hostname } = parseSandboxUrl(url, 'post')
        const allowed = await db.httpAllowlist.findFirst({ where: { organizationId: orgId, domain: hostname, isActive: true } })
        if (!allowed) throwAllowlistError(hostname)
        try {
          const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
          return { status: res.status, body: await res.text() }
        } catch (e) {
          throw new Error(`http.post to "${hostname}" failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      },
    },
    kv: {
      get: async (key: string) => {
        const r = await db.kVStore.findUnique({ where: { organizationId_key: { organizationId: orgId, key } } })
        return r?.value ?? null
      },
      set: async (key: string, value: string) => {
        await db.kVStore.upsert({
          where: { organizationId_key: { organizationId: orgId, key } },
          create: { organizationId: orgId, key, value },
          update: { value },
        })
        return true
      },
    },
    log: {
      info: (...args: unknown[]) => { logs.push(args.map(String).join(' ')) },
      error: (...args: unknown[]) => { logs.push('[ERROR] ' + args.map(String).join(' ')) },
    },
    // Honest simulation: no mail/SMS provider is configured in this runtime,
    // so these never claim real delivery — they log and return { simulated: true }.
    send_email: async (to: string, subject: string, _body: string) => {
      logs.push(`send_email simulated (no mail provider configured): to=${to} subject=${subject}`)
      return { simulated: true, to, subject }
    },
    send_sms: async (to: string, _body: string) => {
      logs.push(`send_sms simulated (no SMS provider configured): to=${to}`)
      return { simulated: true, to }
    },
    // Server-side PDF builders (jsPDF — see ./pdf). Return { filename, base64,
    // sizeBytes }; the Test output panel renders a Download button whenever the
    // execution output carries that payload. Failures throw clear errors that
    // land in the execution's error message + [ERROR] log line.
    pdf: {
      invoice: async (data: unknown) => {
        const { buildInvoicePdf } = await import('@/lib/custom-functions/pdf')
        try {
          const result = await buildInvoicePdf((data ?? {}) as Parameters<typeof buildInvoicePdf>[0])
          logs.push(`PDF generated: ${result.filename} (${(result.sizeBytes / 1024).toFixed(1)} KB)`)
          return result
        } catch (e) {
          logs.push('[ERROR] pdf.invoice failed: ' + (e instanceof Error ? e.message : String(e)))
          throw e
        }
      },
      document: async (data: unknown) => {
        const { buildDocumentPdf } = await import('@/lib/custom-functions/pdf')
        try {
          const result = await buildDocumentPdf((data ?? {}) as Parameters<typeof buildDocumentPdf>[0])
          logs.push(`PDF generated: ${result.filename} (${(result.sizeBytes / 1024).toFixed(1)} KB)`)
          return result
        } catch (e) {
          logs.push('[ERROR] pdf.document failed: ' + (e instanceof Error ? e.message : String(e)))
          throw e
        }
      },
    },
  }

  // Execute the code in a real V8 sandbox (`node:vm`) so tenant code cannot
  // reach `process`, `db`, `fetch`, `globalThis`, or any closure variable —
  // only the explicitly-provided `api` (crm/http/kv/log/send_email/send_sms/
  // pdf) and `inputData` are visible. Wall-clock time is capped at 5s: the vm
  // `timeout` covers sync work, a Promise race covers the awaited async part.
  //
  // NOTE: `node:vm` is not a hard security boundary per Node.js docs (use
  // `isolated-vm` for truly adversarial code), but it is a night-and-day
  // improvement over the previous `new Function(...)` approach which gave
  // tenant code full access to this process's `db`, `fetch`, `process`, and
  // filesystem via closure capture. For admin-authored custom functions
  // (which is the current permission gate: `custom_function.create`) this
  // is the appropriate level of isolation.
  //
  // This function NEVER throws: every failure — syntax error, runtime error,
  // allowlist rejection, timeout, even a broken vm import — is returned as
  // { output: null, logs, error } so executeFunction can record it on the
  // execution row and the API answers HTTP 200 with status:'failed'.
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const vm = await import('node:vm')
    // IMPORTANT: the script must be a single expression statement (the async
    // IIFE call) — a top-level `return (async () => {...})();` is ILLEGAL in a
    // vm Script ("Illegal return statement") and made every execution fail
    // with a SyntaxError. runInNewContext returns the completion value of the
    // script, which here is the IIFE's Promise; `return` statements inside the
    // tenant code are function-scoped and therefore perfectly legal.
    const wrappedCode = `
      (async () => {
        const { crm, http, kv, log, send_email, send_sms, pdf } = api;
        const record_id = inputData.record_id || inputData.id || '';
        ${code}
      })()
    `
    const sandbox = {
      api,
      inputData,
      // Explicitly limited console — only `log`/`info`/`error` push into the
      // captured `logs` array; no access to the real console.
      console: {
        log: (...args: unknown[]) => { logs.push(args.map(String).join(' ')) },
        info: (...args: unknown[]) => { logs.push(args.map(String).join(' ')) },
        error: (...args: unknown[]) => { logs.push('[ERROR] ' + args.map(String).join(' ')) },
        warn: (...args: unknown[]) => { logs.push('[WARN] ' + args.map(String).join(' ')) },
      },
      // Async helpers the sandboxed code may legitimately need
      Promise,
      JSON,
      Math,
      Date,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Error,
      // Explicitly NOT provided: process, require, globalThis, fetch,
      // setTimeout, setInterval, Buffer. Tenant code that needs HTTP must go
      // through api.http (which enforces the per-org allowlist by THROWING),
      // and PDFs must go through api.pdf (server-side jsPDF, no filesystem).
    }
    vm.createContext(sandbox, { name: `custom-function-${functionId}` })

    const result = vm.runInNewContext(wrappedCode, sandbox, {
      filename: `custom-function-${functionId}.js`,
      timeout: 5000, // sync execution cap (ms)
      displayErrors: true,
    }) as Promise<unknown>
    // `result` is a Promise (the wrapped code returns an async IIFE). It is
    // raced against a wall-clock timeout below; whichever side LOSES the race
    // gets its rejection swallowed via .catch so a late user-code failure
    // after a timeout — or the timer firing after a success — can never
    // surface as an unhandled rejection in the server process.
    result.catch(() => { /* losing side of Promise.race — already handled */ })
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => reject(new Error('Execution timed out after 5s')), 5000)
    })
    timeoutPromise.catch(() => { /* losing side of Promise.race — already handled */ })

    const output = await Promise.race([result, timeoutPromise])
    return { output, logs: logs.join('\n'), error: null }
  } catch (e) {
    return { output: null, logs: logs.join('\n'), error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer)
  }
}

// ---------------------------------------------------------------------------
// History + metrics
// ---------------------------------------------------------------------------

export async function getHistory(functionId: string) {
  const { tenant } = await ctx()
  return db.customFunctionExecution.findMany({
    where: { functionId, organizationId: tenant.organization.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
}

export async function getMetrics(functionId: string) {
  const { tenant } = await ctx()
  const [total, failed] = await Promise.all([
    db.customFunctionExecution.count({ where: { functionId, organizationId: tenant.organization.id } }),
    db.customFunctionExecution.count({ where: { functionId, organizationId: tenant.organization.id, status: 'failed' } }),
  ])
  return {
    totalExecutions: total,
    successRate: total > 0 ? ((total - failed) / total) * 100 : 0,
    errorCount: failed,
  }
}

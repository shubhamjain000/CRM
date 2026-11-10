import ZAI from 'z-ai-web-dev-sdk'

export interface ParsedTask {
  title: string
  dueDate?: string // ISO
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  description?: string
  tags?: string[]
}

/**
 * Natural-language task parser using LLM.
 * "Call John tomorrow 3pm" → { title, dueDate, priority }
 * Falls back to a simple regex parser if the LLM is unavailable.
 */
export async function parseNaturalLanguageTask(input: string): Promise<ParsedTask> {
  // Try LLM first
  try {
    const zai = await ZAI.create()
    const now = new Date().toISOString()
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content: `You are a task parser. Given a natural language task description, extract structured data.
Return ONLY valid JSON (no markdown, no explanation) with this shape:
{"title": string, "dueDate": ISO string or null, "priority": "low"|"medium"|"high"|"urgent", "description": string or null, "tags": string[]}
Current time: ${now}. Infer dueDate from relative words (today, tomorrow, next week, etc.).
If no priority is mentioned, default to "medium". If no due date, use null.`,
        },
        { role: 'user', content: input },
      ],
      thinking: { type: 'disabled' },
    })
    const raw = completion.choices[0]?.message?.content?.trim() ?? ''
    const json = JSON.parse(raw)
    return {
      title: json.title ?? input,
      dueDate: json.dueDate ?? undefined,
      priority: json.priority ?? 'medium',
      description: json.description ?? undefined,
      tags: json.tags ?? [],
    }
  } catch {
    // Fallback: simple regex parser
    return fallbackParse(input)
  }
}

function fallbackParse(input: string): ParsedTask {
  const result: ParsedTask = { title: input, priority: 'medium' }
  const lower = input.toLowerCase()
  const now = new Date()

  // Priority detection
  if (/\burgent\b/.test(lower)) result.priority = 'urgent'
  else if (/\bhigh priority\b/.test(lower)) result.priority = 'high'
  else if (/\blow priority\b/.test(lower)) result.priority = 'low'

  // Due date detection
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
  const nextWeek = new Date(now); nextWeek.setDate(now.getDate() + 7)
  const today = new Date(now)

  if (/\btoday\b/.test(lower)) {
    result.dueDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 17, 0).toISOString()
    result.title = input.replace(/\btoday\b/i, '').trim()
  } else if (/\btomorrow\b/.test(lower)) {
    const m = lower.match(/(\d{1,2})\s*(am|pm)?/)
    const hour = m ? parseInt(m[1]) : 9
    const adj = m && m[2] === 'pm' && hour < 12 ? hour + 12 : hour
    result.dueDate = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), adj, 0).toISOString()
    result.title = input.replace(/\btomorrow\b/i, '').replace(/\d{1,2}\s*(am|pm)?/i, '').trim()
  } else if (/\bnext week\b/.test(lower)) {
    result.dueDate = nextWeek.toISOString()
    result.title = input.replace(/\bnext week\b/i, '').trim()
  }

  // Tags
  const tags = input.match(/#(\w+)/g)
  if (tags) result.tags = tags.map((t) => t.slice(1))

  result.title = result.title.replace(/\s+/g, ' ').trim() || input
  return result
}

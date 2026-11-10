'use client'

import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTheme } from 'next-themes'
import { Check, Copy } from 'lucide-react'
// The full Prism grammar bundle is LARGE — lazy-load it (React.lazy) so it is
// only fetched when a chat message actually contains a fenced code block. The
// package ships no bundled types; the project's noImplicitAny=false makes these
// resolve as `any` (runtime paths verified in react-syntax-highlighter 15.6).
const SyntaxHighlighterLazy = React.lazy(async () => {
  const [{ Prism }, { oneLight, vscDarkPlus }] = await Promise.all([
    import('react-syntax-highlighter'),
    import('react-syntax-highlighter/dist/esm/styles/prism'),
  ])
  return {
    default: (props: { dark: boolean } & Record<string, unknown>) => (
      <Prism
        style={props.dark ? (vscDarkPlus as Record<string, React.CSSProperties>) : (oneLight as Record<string, React.CSSProperties>)}
        {...Object.fromEntries(Object.entries(props).filter(([k]) => k !== 'dark'))}
      />
    ),
  }
})

/**
 * Chat markdown renderer for Zia assistant messages.
 *
 * Security: react-markdown escapes raw HTML by default and we deliberately do
 * NOT enable rehype-raw, so model output can never inject markup. Links are
 * forced to target="_blank" + rel="noopener noreferrer".
 */

/** Flatten a React node tree (react-markdown children) into plain text. */
function nodeToString(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeToString).join('')
  if (React.isValidElement(node)) {
    return nodeToString((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

/** Fenced code block with a language label + one-click copy header. */
function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = React.useState(false)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const { resolvedTheme } = useTheme()
  const dark = resolvedTheme === 'dark'

  React.useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable (permissions/insecure context) — silently ignore */
    }
  }

  return (
    <div className={`my-2 overflow-hidden rounded-lg border ${dark ? 'border-zinc-800 bg-zinc-950' : 'border-border bg-muted/40'}`}>
      <div className={`flex items-center justify-between border-b px-3 py-1.5 ${dark ? 'border-zinc-800 bg-zinc-900/70' : 'border-border/70 bg-muted/70'}`}>
        <span className={`font-mono text-[11px] uppercase tracking-wide ${dark ? 'text-zinc-400' : 'text-muted-foreground'}`}>
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={copy}
          className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${dark ? 'text-zinc-300' : 'text-muted-foreground'}`}
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="zia-code overflow-x-auto">
        <React.Suspense
          fallback={
            <pre className="overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed">{code}</pre>
          }
        >
          <SyntaxHighlighterLazy
            dark={dark}
            language={language || 'text'}
            customStyle={{
              margin: 0,
              padding: '0.75rem 1rem',
              background: 'transparent',
              fontSize: 12,
              lineHeight: 1.6,
            }}
            codeTagProps={{
              style: {
                background: 'transparent',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              },
            }}
            wrapLongLines={false}
          >
            {code}
          </SyntaxHighlighterLazy>
        </React.Suspense>
      </div>
    </div>
  )
}

/** Markdown element mapping — sized like chat prose, tables scroll horizontally. */
const MD_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mb-1.5 mt-3 text-[15px] font-semibold leading-snug">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-2.5 text-sm font-semibold leading-snug">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold leading-snug">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-2 text-[13px] font-semibold leading-snug">{children}</h4>,
  p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5 marker:text-muted-foreground/70">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5 marker:text-muted-foreground/70">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-primary/40 pl-2.5 italic text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-border/60" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</th>
  ),
  td: ({ children }) => <td className="border-t px-2 py-1.5 align-top">{children}</td>,
  tr: ({ children }) => <tr>{children}</tr>,
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.82em] font-medium">{children}</code>
  ),
  pre: ({ children }) => {
    const first = React.Children.toArray(children)[0]
    if (React.isValidElement<{ className?: string; children?: React.ReactNode }>(first)) {
      const className = first.props.className ?? ''
      const match = /language-([\w+#-]+)/.exec(className)
      return <CodeBlock code={nodeToString(first.props.children).replace(/\n$/, '')} language={match?.[1] ?? ''} />
    }
    return <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">{children}</pre>
  },
}

const MarkdownInner = React.memo(function MarkdownInner({ text }: { text: string }) {
  return (
    <div className="zia-md break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
})

/**
 * If markdown parsing ever throws at render time, fall back to rendering the
 * raw text as plain paragraphs instead of crashing the whole chat panel.
 */
class MarkdownErrorBoundary extends React.Component<{ text: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <p className="whitespace-pre-wrap break-words">{this.props.text}</p>
    }
    return this.props.children
  }
}

/** Public entry: renders GFM markdown (headings, lists, tables, code blocks) safely. */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <MarkdownErrorBoundary text={text}>
      <MarkdownInner text={text} />
    </MarkdownErrorBoundary>
  )
}

'use client'

import * as React from 'react'
import nextDynamic from 'next/dynamic'
import { Sparkles } from 'lucide-react'

/**
 * Click-to-load mount for the Zia chatbot.
 *
 * The chat module graph (react-markdown, remark-gfm, Prism syntax
 * highlighting) is heavy — especially in dev, where every reachable module is
 * compiled into the root page's graph. The full chat now only loads the FIRST
 * time the user opens it, so regular page loads never pay that cost. The
 * placeholder launcher renders the same visual as the real one (identical
 * classes), so there is no visible difference before the first click.
 */
const ZiaChatbot = nextDynamic(
  () => import('@/components/ai/zia-chatbot').then((m) => ({ default: m.ZiaChatbot })),
  { ssr: false, loading: () => null },
)

export function ZiaChatbotLazy() {
  const [activated, setActivated] = React.useState(false)

  if (activated) return <ZiaChatbot autoOpen />

  return (
    <button
      type="button"
      onClick={() => setActivated(true)}
      className="fixed bottom-4 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 animate-in fade-in slide-in-from-bottom-2 duration-200 sm:bottom-6 sm:right-6"
      aria-label="Open Zia AI assistant"
    >
      <Sparkles className="size-6" />
    </button>
  )
}

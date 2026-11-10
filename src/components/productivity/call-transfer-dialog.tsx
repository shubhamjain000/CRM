'use client'

import * as React from 'react'
import { PhoneForwarded, Loader2, Search, ArrowRight } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { toast } from 'sonner'
import { useOrgMembers } from '@/components/crm/owner'

// Tone palette mirrored from owner.tsx so transfer targets look identical to
// the owner cells already shown across the CRM.
const AVATAR_TONES = [
  'bg-primary/12 text-primary dark:bg-primary/20 dark:text-primary',
  'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/14 text-amber-700 dark:text-amber-300',
  'bg-rose-500/12 text-rose-700 dark:text-rose-300',
  'bg-teal-500/12 text-teal-700 dark:text-teal-300',
  'bg-violet-500/12 text-violet-700 dark:text-violet-300',
]
function toneFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_TONES[hash % AVATAR_TONES.length]
}
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export interface CallTransferDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The call log to transfer. */
  callId: string | null
  /** Current owner — excluded from the target list (no-op transfer). */
  currentOwnerId?: string | null
  /** Optional context label (subject / phone) shown in the header. */
  callLabel?: string
  /** Called after a successful transfer so the caller can refresh its list. */
  onTransferred?: (result: { callId: string; newOwnerId: string }) => void
}

export function CallTransferDialog({
  open, onOpenChange, callId, currentOwnerId, callLabel, onTransferred,
}: CallTransferDialogProps) {
  const { members } = useOrgMembers()
  const [selected, setSelected] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  // Reset the form whenever the dialog is (re)opened.
  React.useEffect(() => {
    if (open) {
      setSelected(null)
      setNotes('')
      setQuery('')
    }
  }, [open, callId])

  const targets = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return members
      .filter((m) => m.id !== currentOwnerId)
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [members, currentOwnerId, query])

  const submit = async () => {
    if (!callId || !selected) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/productivity/calls/${callId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferredToId: selected, notes: notes.trim() || undefined }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data?.error || `Transfer failed (${res.status})`)
      }
      toast.success('Call transferred', {
        description: members.find((m) => m.id === selected)?.name ?? 'New owner assigned',
      })
      onTransferred?.({ callId, newOwnerId: selected })
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not transfer the call')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PhoneForwarded className="size-4 text-muted-foreground" aria-hidden />
            Transfer call
          </DialogTitle>
          <DialogDescription>
            Reassign this call log to another team member. Admins only — the
            handoff is recorded on the call history.
            {callLabel && <span className="block truncate pt-1 font-medium text-foreground">{callLabel}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="transfer-search">Transfer to</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="transfer-search"
                className="pl-8"
                placeholder="Search members"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border">
            {targets.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {members.length <= 1 ? 'No other members to transfer to' : 'No members match your search'}
              </p>
            ) : (
              <ul className="divide-y">
                {targets.map((m) => {
                  const active = selected === m.id
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(m.id)}
                        aria-pressed={active}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                          active ? 'bg-primary/8 dark:bg-primary/12' : 'hover:bg-muted/60'
                        }`}
                      >
                        <Avatar className="size-8 shrink-0">
                          <AvatarFallback className={`text-xs font-semibold ${toneFor(m.id)}`}>
                            {initialsOf(m.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{m.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                        </span>
                        {active && <ArrowRight className="size-4 shrink-0 text-primary dark:text-primary" aria-hidden />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="transfer-notes">Note (optional)</Label>
            <Input
              id="transfer-notes"
              placeholder="Reason / context for the transfer"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!selected || submitting}>
            {submitting ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden /> : null}
            Transfer call
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

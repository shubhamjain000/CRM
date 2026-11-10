'use client'

import * as React from 'react'
import { ArrowRight, Check, Copy, AlertCircle } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

interface Lead {
  id: string; firstName: string; lastName: string; company: string | null
  email?: string; phone?: string; industry?: string | null; annualRevenue?: number | null
}

interface Props {
  lead: Lead | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onConverted: () => void
}

const STEPS = ['Review lead', 'Map fields', 'Create records'] as const

export function ConversionWizard({ lead, open, onOpenChange, onConverted }: Props) {
  const [step, setStep] = React.useState(0)
  const [mapping, setMapping] = React.useState({ accountName: '', contactEmail: '', dealName: '', dealAmount: 0 })
  const [dedup, setDedup] = React.useState<{ accounts: number; contacts: number } | null>(null)
  const [converting, setConverting] = React.useState(false)

  React.useEffect(() => {
    if (lead && open) {
      setStep(0)
      setMapping({
        accountName: lead.company ?? `${lead.firstName} ${lead.lastName}`,
        contactEmail: lead.email ?? '',
        dealName: `${lead.company ?? lead.firstName + ' ' + lead.lastName} — Deal`,
        dealAmount: lead.annualRevenue ? Math.round(lead.annualRevenue * 0.1) : 0,
      })
      // Check for duplicates
      checkDedup(lead)
    }
  }, [lead, open])

  const checkDedup = async (l: Lead) => {
    try {
      const [a, c] = await Promise.all([
        fetch(`/api/crm/accounts?search=${encodeURIComponent(l.company ?? '')}&limit=1`, { cache: 'no-store' }).then((r) => r.json()),
        l.email ? fetch(`/api/crm/contacts?search=${encodeURIComponent(l.email)}&limit=1`, { cache: 'no-store' }).then((r) => r.json()) : Promise.resolve({ total: 0 }),
      ])
      setDedup({ accounts: a.total ?? 0, contacts: c.total ?? 0 })
    } catch {
      setDedup({ accounts: 0, contacts: 0 })
    }
  }

  const convert = async () => {
    if (!lead) return
    setConverting(true)
    try {
      const res = await fetch(`/api/crm/leads/${lead.id}/convert`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Convert failed')
      toast.success('Lead converted', {
        description: `Account + Contact + Deal created`,
      })
      onOpenChange(false)
      onConverted()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Convert failed')
    } finally {
      setConverting(false)
    }
  }

  if (!lead) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Convert lead</DialogTitle>
          <DialogDescription>Create an account, contact, and deal from this lead.</DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex flex-1 items-center gap-2">
              <div className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
                i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}>
                {i < step ? <Check className="size-3" /> : i + 1}
              </div>
              <span className={`text-xs ${i === step ? 'font-medium' : 'text-muted-foreground'}`}>{s}</span>
              {i < STEPS.length - 1 && <div className="h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>

        {/* Step content */}
        {step === 0 && (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="font-medium">{lead.firstName} {lead.lastName}</p>
              <p className="text-sm text-muted-foreground">{lead.company ?? 'No company'}</p>
              {lead.email && <p className="text-xs text-muted-foreground">{lead.email}</p>}
            </div>
            {dedup && (dedup.accounts > 0 || dedup.contacts > 0) && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <div>
                  <p className="font-medium text-amber-700 dark:text-amber-400">Possible duplicates detected</p>
                  <p className="text-xs text-muted-foreground">
                    {dedup.accounts > 0 && `${dedup.accounts} account(s) `}
                    {dedup.contacts > 0 && `${dedup.contacts} contact(s) `}
                    with matching info.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Account name</Label>
              <Input value={mapping.accountName} onChange={(e) => setMapping({ ...mapping, accountName: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Contact email</Label>
              <Input value={mapping.contactEmail} onChange={(e) => setMapping({ ...mapping, contactEmail: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Deal name</Label>
              <Input value={mapping.dealName} onChange={(e) => setMapping({ ...mapping, dealName: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Deal amount</Label>
              <Input type="number" value={mapping.dealAmount} onChange={(e) => setMapping({ ...mapping, dealAmount: Number(e.target.value) })} />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">The following records will be created:</p>
            {[
              { label: 'Account', value: mapping.accountName },
              { label: 'Contact', value: `${lead.firstName} ${lead.lastName}` },
              { label: 'Deal', value: mapping.dealName },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-2 rounded-lg border p-2.5">
                <div className="flex size-7 items-center justify-center rounded bg-primary/10 text-primary"><Copy className="size-3.5" /></div>
                <div className="flex-1"><p className="text-xs text-muted-foreground">{r.label}</p><p className="text-sm font-medium">{r.value}</p></div>
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">New</Badge>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">A follow-up task will also be created, and the conversion logged in the audit trail.</p>
          </div>
        )}

        <DialogFooter>
          {step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}>Back</Button>}
          {step < 2 ? (
            <Button onClick={() => setStep(step + 1)}>Next <ArrowRight className="ml-1.5 size-4" /></Button>
          ) : (
            <Button onClick={convert} disabled={converting}>{converting ? 'Converting…' : 'Convert lead'}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

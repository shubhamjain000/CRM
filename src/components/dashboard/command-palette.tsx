'use client'

import * as React from 'react'
import { Search, Inbox, Cog, Users, ShieldCheck, FileText, MonitorSmartphone, Smartphone, Target, UserCircle, Briefcase, HandCoins, Settings2, Database, Trash2, ListTodo, Calendar, Phone, StickyNote, FolderOpen, Rss, GitBranch, AlertTriangle, BarChart3, Workflow, LayoutDashboard, Zap, Activity, Code2, Mail, Phone as PhoneIcon, Inbox as InboxIcon, FileText as FileTextIcon, Megaphone, Package, LoaderCircle, Plug, ScrollText, KeyRound } from 'lucide-react'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useAuth } from '@/store/auth'
import { useRecordNav } from '@/store/record-nav'
import { useTranslations } from 'next-intl'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  onNavigate: (view: string) => void
}

interface SearchHit {
  module: string
  id: string
  name: string
  subtitle: string
}

/** Search-hit module → the nav view that owns it + its icon. */
const MODULE_META: Record<string, { view: string; label: string; icon: React.ElementType }> = {
  lead: { view: 'leads', label: 'Lead', icon: Target },
  contact: { view: 'contacts', label: 'Contact', icon: UserCircle },
  account: { view: 'accounts', label: 'Account', icon: Briefcase },
  deal: { view: 'deals', label: 'Deal', icon: HandCoins },
  campaign: { view: 'campaigns', label: 'Campaign', icon: Megaphone },
  product: { view: 'inventory', label: 'Product', icon: Package },
}

export function CommandPalette({ open, onOpenChange, onNavigate }: Props) {
  const t = useTranslations()
  const { organizations, switchOrg } = useAuth()
  const openRecord = useRecordNav((s) => s.openRecord)
  const [query, setQuery] = React.useState('')
  const [records, setRecords] = React.useState<SearchHit[]>([])
  const [searching, setSearching] = React.useState(false)

  // Live record search — debounced, abortable, only from 2 characters.
  React.useEffect(() => {
    const q = query.trim()
    if (!open || q.length < 2) {
      setRecords([])
      setSearching(false)
      return
    }
    const ctrl = new AbortController()
    setSearching(true)
    const timer = setTimeout(() => {
      fetch(`/api/crm/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setRecords(Array.isArray(d?.results) ? d.results : []))
        .catch(() => {})
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false)
        })
    }, 200)
    return () => {
      ctrl.abort()
      clearTimeout(timer)
    }
  }, [query, open])

  // Fresh palette on every open — previous query/results shouldn't linger.
  React.useEffect(() => {
    if (open) {
      setQuery('')
      setRecords([])
    }
  }, [open])

  const go = (view: string) => {
    onNavigate(view)
    onOpenChange(false)
  }

  const openHit = (hit: SearchHit) => {
    const meta = MODULE_META[hit.module]
    if (!meta) return
    openRecord(hit.module, hit.id)
    onNavigate(meta.view)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-lg max-w-xl">
        <Command className="rounded-xl">
          <CommandInput value={query} onValueChange={setQuery} placeholder={t('dashboard.searchPlaceholder')} />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>
              {searching
                ? <span className="flex items-center gap-2"><LoaderCircle className="size-3.5 animate-spin" /> Searching…</span>
                : `No matches for "${query}"`}
            </CommandEmpty>

            {records.length > 0 && (
              <CommandGroup heading="Records">
                {records.map((hit) => {
                  const meta = MODULE_META[hit.module]
                  const Icon = meta?.icon ?? FileText
                  return (
                    <CommandItem key={`${hit.module}-${hit.id}`} value={`record-${hit.module}-${hit.name}`} onSelect={() => openHit(hit)}>
                      <Icon className="mr-2 size-4 text-primary" />
                      <span className="flex-1 truncate">{hit.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{meta?.label ?? hit.module}{hit.subtitle ? ` · ${hit.subtitle}` : ''}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}

            <CommandGroup heading="Navigate">
              <CommandItem onSelect={() => go('overview')}>
                <Search className="mr-2 size-4" /> {t('nav.overview')}
              </CommandItem>
              <CommandItem onSelect={() => go('mobile-app')}>
                <Smartphone className="mr-2 size-4" /> Mobile App
              </CommandItem>
              <CommandItem onSelect={() => go('users')}>
                <Users className="mr-2 size-4" /> {t('nav.users')}
              </CommandItem>
              <CommandItem onSelect={() => go('roles')}>
                <ShieldCheck className="mr-2 size-4" /> {t('nav.roles')}
              </CommandItem>
              <CommandItem onSelect={() => go('audit')}>
                <FileText className="mr-2 size-4" /> {t('nav.auditLog')}
              </CommandItem>
              <CommandItem onSelect={() => go('devices')}>
                <MonitorSmartphone className="mr-2 size-4" /> {t('nav.devices')}
              </CommandItem>
              <CommandItem onSelect={() => go('security')}>
                <Cog className="mr-2 size-4" /> {t('nav.security')}
              </CommandItem>
              <CommandItem onSelect={() => go('api-keys')}>
                <KeyRound className="mr-2 size-4" /> {t('nav.apiKeys')}
              </CommandItem>
            </CommandGroup>

            <CommandGroup heading="CRM">
              <CommandItem onSelect={() => go('leads')}>
                <Target className="mr-2 size-4" /> Leads
              </CommandItem>
              <CommandItem onSelect={() => go('contacts')}>
                <UserCircle className="mr-2 size-4" /> Contacts
              </CommandItem>
              <CommandItem onSelect={() => go('accounts')}>
                <Briefcase className="mr-2 size-4" /> Accounts
              </CommandItem>
              <CommandItem onSelect={() => go('deals')}>
                <HandCoins className="mr-2 size-4" /> Deals
              </CommandItem>
              <CommandItem onSelect={() => go('listings')}>
                <ScrollText className="mr-2 size-4" /> Listings
              </CommandItem>
              <CommandItem onSelect={() => go('campaigns')}>
                <Megaphone className="mr-2 size-4" /> Campaigns
              </CommandItem>
              <CommandItem onSelect={() => go('inventory')}>
                <Package className="mr-2 size-4" /> Inventory
              </CommandItem>
              <CommandItem onSelect={() => go('custom-fields')}>
                <Settings2 className="mr-2 size-4" /> Custom Fields
              </CommandItem>
              <CommandItem onSelect={() => go('crm-setup')}>
                <Database className="mr-2 size-4" /> Setup &amp; Seed
              </CommandItem>
              <CommandItem onSelect={() => go('trash')}>
                <Trash2 className="mr-2 size-4" /> Trash
              </CommandItem>
            </CommandGroup>

            <CommandGroup heading="Productivity">
              <CommandItem onSelect={() => go('tasks')}>
                <ListTodo className="mr-2 size-4" /> Tasks
              </CommandItem>
              <CommandItem onSelect={() => go('calendar')}>
                <Calendar className="mr-2 size-4" /> Calendar
              </CommandItem>
              <CommandItem onSelect={() => go('calls')}>
                <Phone className="mr-2 size-4" /> Calls
              </CommandItem>
            </CommandGroup>

            <CommandGroup heading="Content">
              <CommandItem onSelect={() => go('notes')}>
                <StickyNote className="mr-2 size-4" /> Notes
              </CommandItem>
              <CommandItem onSelect={() => go('files')}>
                <FolderOpen className="mr-2 size-4" /> Files
              </CommandItem>
              <CommandItem onSelect={() => go('feed')}>
                <Rss className="mr-2 size-4" /> Feed
              </CommandItem>
            </CommandGroup>

            <CommandGroup heading="Pipeline">
              <CommandItem onSelect={() => go('pipeline-manager')}>
                <GitBranch className="mr-2 size-4" /> Pipelines
              </CommandItem>
              <CommandItem onSelect={() => go('at-risk')}>
                <AlertTriangle className="mr-2 size-4" /> At Risk
              </CommandItem>
              <CommandItem onSelect={() => go('pipeline-analytics')}>
                <BarChart3 className="mr-2 size-4" /> Analytics
              </CommandItem>
              <CommandItem onSelect={() => go('blueprint-editor')}>
                <Workflow className="mr-2 size-4" /> Blueprints
              </CommandItem>
              <CommandItem onSelect={() => go('blueprint-dashboard')}>
                <LayoutDashboard className="mr-2 size-4" /> BP Dashboard
              </CommandItem>
              <CommandItem onSelect={() => go('approvals')}>
                <ShieldCheck className="mr-2 size-4" /> Approvals
              </CommandItem>
              <CommandItem onSelect={() => go('rules')}>
                <Cog className="mr-2 size-4" /> Rules
              </CommandItem>
              <CommandItem onSelect={() => go('workflows')}>
                <Zap className="mr-2 size-4" /> Workflows
              </CommandItem>
              <CommandItem onSelect={() => go('workflow-dashboard')}>
                <Activity className="mr-2 size-4" /> Exec Dashboard
              </CommandItem>
              <CommandItem onSelect={() => go('custom-functions')}>
                <Code2 className="mr-2 size-4" /> Functions
              </CommandItem>
            </CommandGroup>

            <CommandGroup heading="Communication">
              <CommandItem onSelect={() => go('email')}>
                <Mail className="mr-2 size-4" /> Email
              </CommandItem>
              <CommandItem onSelect={() => go('telephony')}>
                <PhoneIcon className="mr-2 size-4" /> Telephony
              </CommandItem>
              <CommandItem onSelect={() => go('inbox')}>
                <InboxIcon className="mr-2 size-4" /> Unified Inbox
              </CommandItem>
              <CommandItem onSelect={() => go('channels')}>
                <Plug className="mr-2 size-4" /> Channels
              </CommandItem>
            </CommandGroup>

            <CommandGroup heading="Analytics">
              <CommandItem onSelect={() => go('reports')}>
                <FileTextIcon className="mr-2 size-4" /> Reports
              </CommandItem>
              <CommandItem onSelect={() => go('analytics-dashboard')}>
                <BarChart3 className="mr-2 size-4" /> Analytics Dashboard
              </CommandItem>
            </CommandGroup>

            {organizations.length > 1 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t('dashboard.switchOrg')}>
                  {organizations.map((o) => (
                    <CommandItem
                      key={o.id}
                      onSelect={async () => {
                        await switchOrg(o.id)
                        onOpenChange(false)
                      }}
                    >
                      <Inbox className="mr-2 size-4" />
                      <span className="flex-1">{o.name}</span>
                      {o.isCurrent && <span className="text-xs text-muted-foreground">current</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

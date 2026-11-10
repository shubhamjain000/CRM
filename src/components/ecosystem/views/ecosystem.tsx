'use client'

import * as React from 'react'
import { Store, Plug, FileText, FileDown, LifeBuoy, FolderKanban, Plus, Trash2, CheckCircle2, Download, Loader2, Globe, PlugZap, FlaskConical, RefreshCw, Pencil, Star, ShieldCheck, Settings2, Wrench, X, CircleAlert, ExternalLink, KeyRound } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { downloadBlob } from '@/components/download-toast'
import { invoiceDocxBlob, invoicePdfBlob } from '@/lib/invoice-docs'
import { fmtINR } from '@/lib/money'
import { REDACTED, type ProviderConnectSpec } from '@/lib/integrations/providers'
import { toast } from 'sonner'

const TAB_TRIGGER = 'shrink-0 px-3 min-h-9'

export function EcosystemView() {
  // Controlled so the marketplace detail sheet can deep-link to Integrations.
  const [tab, setTab] = React.useState('marketplace')
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold tracking-tight">Ecosystem</h1><p className="text-muted-foreground">Marketplace, integrations, and sister apps</p></div>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="w-full overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="w-full justify-start sm:w-auto sm:justify-center">
            <TabsTrigger value="marketplace" className={TAB_TRIGGER}><Store className="mr-1.5 size-3.5" /> Marketplace</TabsTrigger>
            <TabsTrigger value="integrations" className={TAB_TRIGGER}><Plug className="mr-1.5 size-3.5" /> Integrations</TabsTrigger>
            <TabsTrigger value="invoicing" className={TAB_TRIGGER}><FileText className="mr-1.5 size-3.5" /> Invoicing</TabsTrigger>
            <TabsTrigger value="support" className={TAB_TRIGGER}><LifeBuoy className="mr-1.5 size-3.5" /> Support</TabsTrigger>
            <TabsTrigger value="projects" className={TAB_TRIGGER}><FolderKanban className="mr-1.5 size-3.5" /> Projects</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="marketplace" className="mt-4"><MarketplaceTab onConfigureIntegration={() => setTab('integrations')} /></TabsContent>
        <TabsContent value="integrations" className="mt-4"><IntegrationsTab /></TabsContent>
        <TabsContent value="invoicing" className="mt-4"><InvoicingTab /></TabsContent>
        <TabsContent value="support" className="mt-4"><SupportTab /></TabsContent>
        <TabsContent value="projects" className="mt-4"><ProjectsTab /></TabsContent>
      </Tabs>
    </div>
  )
}

function MarketplaceTab({ onConfigureIntegration }: { onConfigureIntegration: () => void }) {
  const [catalog, setCatalog] = React.useState<any[] | null>(null)
  const [installed, setInstalled] = React.useState<any[]>([])
  const [installing, setInstalling] = React.useState<string | null>(null)
  const [uninstalling, setUninstalling] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<any | null>(null)
  const [providerConnection, setProviderConnection] = React.useState<{ isConnected: boolean } | null>(null)
  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/marketplace', { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load the marketplace')
      const d = await res.json()
      setCatalog(d.catalog ?? [])
      setInstalled(d.installed ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the marketplace')
      setCatalog([])
    }
  }, [])
  React.useEffect(() => { load() }, [load])

  // Provider connection state is only needed while the detail sheet is open.
  React.useEffect(() => {
    if (!selected?.provider) { setProviderConnection(null); return }
    let cancelled = false
    fetch('/api/integrations', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { integrations: [] }))
      .then((d) => {
        if (!cancelled) {
          const hit = (d.integrations ?? []).find((i: any) => i.provider === selected.provider)
          setProviderConnection(hit ? { isConnected: !!hit.isConnected } : { isConnected: false })
        }
      })
      .catch(() => { if (!cancelled) setProviderConnection({ isConnected: false }) })
    return () => { cancelled = true }
  }, [selected])

  const install = async (name: string) => {
    setInstalling(name)
    try {
      const res = await fetch('/api/marketplace/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || 'Install failed')
      // Optimistic flip — the server returns the fresh InstalledExtension row.
      if (d?.installed) {
        setInstalled((prev) => [...prev.filter((i: any) => i.extension?.name !== name), d.installed])
      }
      toast.success(`${name} installed`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not install ${name}`)
    } finally {
      setInstalling(null)
    }
  }

  const uninstall = async (ext: any) => {
    const record = installed.find((i: any) => i.extension?.name === ext.name && i.status === 'active')
    if (!record) return
    setUninstalling(ext.name)
    try {
      const res = await fetch('/api/marketplace/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'uninstall', extensionId: record.extensionId }) })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || 'Uninstall failed')
      // Card returns to 'Install' immediately; keep the disabled row for audit.
      setInstalled((prev) => prev.map((i: any) => (i.extension?.name === ext.name ? { ...i, status: 'disabled' } : i)))
      toast.success(`${ext.name} uninstalled`, { description: 'Its data hooks and panels were removed.' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not uninstall ${ext.name}`)
    } finally {
      setUninstalling(null)
    }
  }

  const isInstalled = (name: string) => installed.some((i: any) => i.extension?.name === name && i.status === 'active')
  const categories = [...new Set(catalog?.map(c => c.category) ?? [])]
  return (
    <div className="space-y-4">
      {catalog === null ? <Skeleton className="h-64 w-full" /> : categories.map(cat => (
        <div key={cat}>
          <h3 className="mb-2 text-sm font-semibold capitalize text-muted-foreground">{cat}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.filter(c => c.category === cat).map(ext => (
              <Card key={ext.name} className="cursor-pointer py-4 transition-colors hover:bg-muted/40" onClick={() => setSelected(ext)}>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{ext.name}</span>
                    {ext.isVerified && <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 text-[10px]">✓ verified</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{ext.description}</p>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary" className="text-[10px] capitalize">{ext.pricing}</Badge>
                    {isInstalled(ext.name) ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 text-[10px]"><CheckCircle2 className="mr-0.5 size-2.5" /> Installed</Badge> :
                      <Button size="sm" variant="outline" disabled={installing === ext.name} onClick={(e) => { e.stopPropagation(); void install(ext.name) }}>
                        {installing === ext.name ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Download className="mr-1 size-3" />} Install
                      </Button>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
      <MarketplaceDetailSheet
        ext={selected}
        onOpenChange={(open) => { if (!open) setSelected(null) }}
        installed={selected ? isInstalled(selected.name) : false}
        installing={!!selected && installing === selected.name}
        uninstalling={!!selected && uninstalling === selected.name}
        providerConnection={providerConnection}
        onInstall={() => selected && install(selected.name)}
        onUninstall={() => selected && uninstall(selected)}
        onConfigureIntegration={onConfigureIntegration}
      />
    </div>
  )
}

/** Detail drawer for one marketplace app: permissions, stats, install/uninstall. */
function MarketplaceDetailSheet({ ext, onOpenChange, installed, installing, uninstalling, providerConnection, onInstall, onUninstall, onConfigureIntegration }: {
  ext: any | null
  onOpenChange: (open: boolean) => void
  installed: boolean
  installing: boolean
  uninstalling: boolean
  providerConnection: { isConnected: boolean } | null
  onInstall: () => void
  onUninstall: () => void
  onConfigureIntegration: () => void
}) {
  const [confirmUninstall, setConfirmUninstall] = React.useState(false)
  React.useEffect(() => { if (!ext) setConfirmUninstall(false) }, [ext])
  const permissions: string[] = Array.isArray(ext?.permissions) ? ext.permissions : []
  return (
    <Sheet open={!!ext} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        {ext && (
          <>
            <SheetHeader className="space-y-3 border-b p-6 pr-16 text-left">
              <div className="flex items-start gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary" aria-hidden>
                  {ext.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <SheetTitle className="text-lg leading-tight">{ext.name}</SheetTitle>
                  <SheetDescription className="mt-0.5">by {ext.developer}</SheetDescription>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="text-[10px] capitalize">{ext.pricing}</Badge>
                <Badge variant="outline" className="text-[10px] capitalize">{String(ext.category).replace(/_/g, ' ')}</Badge>
                {ext.isVerified && <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 text-[10px]">✓ verified</Badge>}
                {installed && <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 text-[10px]"><CheckCircle2 className="mr-0.5 size-2.5" /> Active</Badge>}
              </div>
              <p className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Star className="size-3.5 fill-amber-400 text-amber-400" /> {Number(ext.rating ?? 0).toFixed(1)}</span>
                <span className="inline-flex items-center gap-1"><Download className="size-3.5" /> {Number(ext.downloads ?? 0).toLocaleString()} installs</span>
              </p>
            </SheetHeader>
            <div className="flex-1 space-y-4 p-6">
              <div>
                <h4 className="mb-1 text-sm font-semibold">About</h4>
                <p className="text-sm text-muted-foreground">{ext.details || ext.description}</p>
              </div>
              {permissions.length > 0 && (
                <div>
                  <h4 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><ShieldCheck className="size-3.5 text-muted-foreground" /> Required permissions</h4>
                  <ul className="space-y-1">
                    {permissions.map((p) => (
                      <li key={p} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-500" aria-hidden /> {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {ext.provider && providerConnection && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-semibold">Connection</h4>
                      <p className="text-xs text-muted-foreground">{providerConnection.isConnected ? 'Connector is live under Integrations.' : 'Connector is set up but not connected.'}</p>
                    </div>
                    {providerConnection.isConnected
                      ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 text-[10px]">Connected</Badge>
                      : <Button size="sm" variant="outline" onClick={onConfigureIntegration}>Configure<Settings2 className="ml-1.5 size-3.5" /></Button>}
                  </div>
                </>
              )}
            </div>
            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background p-4">
              {installed ? (
                <AlertDialog open={confirmUninstall} onOpenChange={setConfirmUninstall}>
                  <Button variant="destructive" disabled={uninstalling} onClick={() => setConfirmUninstall(true)}>
                    {uninstalling ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <X className="mr-1.5 size-4" />} Uninstall
                  </Button>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Uninstall {ext.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes its data hooks and panels. Stored settings for the app are cleared; your CRM records are kept.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => { setConfirmUninstall(false); onUninstall() }}
                      >
                        Uninstall
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <Button onClick={onInstall} disabled={installing}>
                  {installing ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Download className="mr-1.5 size-4" />} Install
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Compact relative time for "last synced" cells. */
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 'never'
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function IntegrationsTab() {
  const [integrations, setIntegrations] = React.useState<any[] | null>(null)
  // Public per-provider connect flows (setup steps + field schemas) from the API.
  const [specs, setSpecs] = React.useState<Record<string, ProviderConnectSpec>>({})
  const [formOpen, setFormOpen] = React.useState(false)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  // Per-integration inline test results: id → {ok, text}
  const [testResults, setTestResults] = React.useState<Record<string, { ok: boolean; text: string }>>({})
  // Guided connect wizard target: the provider plus the row (for prefill when
  // the connection was partially set up before).
  const [wizard, setWizard] = React.useState<{ provider: string; integration: any | null } | null>(null)
  // Disconnect confirm — disconnecting also clears the stored credentials.
  const [confirmDisconnect, setConfirmDisconnect] = React.useState<any | null>(null)
  const load = React.useCallback(async (): Promise<any[]> => {
    try {
      const res = await fetch('/api/integrations', { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load integrations')
      const d = await res.json()
      setIntegrations(d.integrations ?? [])
      const specMap: Record<string, ProviderConnectSpec> = {}
      for (const s of (Array.isArray(d.specs) ? d.specs : []) as ProviderConnectSpec[]) specMap[s.provider] = s
      setSpecs(specMap)
      return d.integrations ?? []
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load integrations')
      setIntegrations([])
      return []
    }
  }, [])
  React.useEffect(() => { load() }, [load])
  const disconnect = async (i: any) => {
    setBusyId(i.id)
    try {
      const res = await fetch('/api/integrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: i.provider, action: 'disconnect' }) })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || 'Request failed')
      toast.success(`${specs[i.provider]?.label ?? i.provider} disconnected`, { description: 'Stored credentials were removed.' })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusyId(null)
    }
  }
  const runTest = async (i: any) => {
    setBusyId(i.id)
    setTestResults((prev) => ({ ...prev, [i.id]: { ok: true, text: 'Testing…' } }))
    try {
      const res = await fetch(`/api/integrations/${i.id}/test`, { method: 'POST' })
      const d = await res.json().catch(() => null)
      if (!res.ok || d?.ok === false) throw new Error(d?.error || d?.message || 'Test failed')
      const latency = typeof d.latencyMs === 'number' && d.latencyMs > 0 ? ` · ${d.latencyMs}ms` : ''
      setTestResults((prev) => ({ ...prev, [i.id]: { ok: true, text: `✓ ${d.message ?? 'Connection healthy'}${latency}` } }))
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [i.id]: { ok: false, text: `✗ ${e instanceof Error ? e.message : 'Test failed'}` } }))
    } finally {
      setBusyId(null)
    }
  }
  const api = integrations?.find((i) => i.provider === 'custom_api') ?? null
  const others = (integrations ?? []).filter((i) => i.provider !== 'custom_api')
  /** A row is "broken" when disconnected-with-config, the newest log is an
   *  error, or the latest manual test failed. */
  const rowStatus = (i: any): 'connected' | 'disconnected' | 'error' => {
    const lastLog = (i.logs ?? [])[0]
    const test = testResults[i.id]
    if (test && !test.ok) return 'error'
    if (lastLog?.status === 'error') return 'error'
    return i.isConnected ? 'connected' : 'disconnected'
  }
  /** True when the redacted config holds at least one saved value. */
  const hasSavedConfig = (i: any) => {
    try {
      const cfg = JSON.parse(i.config || '{}')
      return Object.values(cfg).some((v) => typeof v === 'string' && v.length > 0)
    } catch { return false }
  }
  return (
    <div className="space-y-4">
      <ApiImportCard api={api} onOpenForm={() => setFormOpen(true)} onChanged={load} />
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Connected Integrations</CardTitle>
            <CardDescription>Connect walks you through each app's setup steps and validates the credentials before saving.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {!integrations ? <Skeleton className="h-32 w-full" /> : others.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nothing here yet — install an app in the Marketplace tab, then press Connect to walk through its setup steps.</p> :
            <ul className="space-y-2">{others.map((i) => {
              const status = rowStatus(i)
              const test = testResults[i.id]
              const spec = specs[i.provider]
              const label = spec?.label ?? i.provider.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
              const saved = hasSavedConfig(i)
              return (
                <li key={i.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Plug className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{label}</span>
                      <p className="text-xs text-muted-foreground">
                        {i.isConnected ? `Connected · last synced ${timeAgo(i.lastSyncedAt)}` : saved ? 'Credentials saved — finish the connection' : 'Not connected yet'}
                      </p>
                    </div>
                    {status === 'connected' && <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">Connected</Badge>}
                    {status === 'disconnected' && <Badge variant="outline" className="text-muted-foreground">Disconnected</Badge>}
                    {status === 'error' && <Badge variant="destructive">Error</Badge>}
                    <div className="flex items-center gap-1.5">
                      {status === 'error' && (
                        <Button size="sm" variant="destructive" className="min-h-9" disabled={busyId === i.id} onClick={() => void runTest(i)}>
                          {busyId === i.id ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Wrench className="mr-1.5 size-3.5" />} Fix Connection
                        </Button>
                      )}
                      {status !== 'error' && (
                        <Button size="sm" variant="outline" className="min-h-9" disabled={busyId === i.id} onClick={() => void runTest(i)}>
                          {busyId === i.id ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <FlaskConical className="mr-1.5 size-3.5" />} Test
                        </Button>
                      )}
                      {i.isConnected ? (
                        <Button size="sm" variant="outline" className="min-h-9" disabled={busyId === i.id} onClick={() => setWizard({ provider: i.provider, integration: i })}>
                          <Pencil className="mr-1.5 size-3.5" /> Manage
                        </Button>
                      ) : (
                        <Button size="sm" className="min-h-9" disabled={busyId === i.id} onClick={() => setWizard({ provider: i.provider, integration: i })}>
                          <KeyRound className="mr-1.5 size-3.5" /> {saved ? 'Finish setup' : 'Connect'}
                        </Button>
                      )}
                      {i.isConnected && (
                        <Button size="sm" variant="outline" className="min-h-9" disabled={busyId === i.id} onClick={() => setConfirmDisconnect(i)}>Disconnect</Button>
                      )}
                    </div>
                  </div>
                  {test && (
                    <p className={`mt-2 break-words text-xs ${test.ok ? 'text-emerald-600' : 'text-destructive'}`}>{test.text}</p>
                  )}
                </li>
              )
            })}</ul>}
        </CardContent>
      </Card>
      <ApiImportDialog open={formOpen} onOpenChange={setFormOpen} api={api} onSaved={load} />
      <ConnectProviderDialog
        target={wizard}
        specs={specs}
        onClose={() => setWizard(null)}
        onSaved={load}
        runTest={(row) => void runTest(row)}
      />
      <AlertDialog open={!!confirmDisconnect} onOpenChange={(open) => { if (!open) setConfirmDisconnect(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {confirmDisconnect ? (specs[confirmDisconnect.provider]?.label ?? confirmDisconnect.provider) : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              The connection stops syncing immediately and the stored credentials are removed from this workspace. You can connect again any time — the wizard will ask for the credentials once more.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { const row = confirmDisconnect; setConfirmDisconnect(null); if (row) void disconnect(row) }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Guided connect wizard — renders the provider's setup steps, collects the
// credential fields and saves them (secrets masked with __SAVED__, restored
// server-side). Providers without a spec fall back to a one-click connect.
// ---------------------------------------------------------------------------

function ConnectProviderDialog({ target, specs, onClose, onSaved, runTest }: {
  target: { provider: string; integration: any | null } | null
  specs: Record<string, ProviderConnectSpec>
  onClose: () => void
  onSaved: () => Promise<any[]>
  runTest: (row: any) => void
}) {
  const spec = target ? specs[target.provider] : undefined
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [connectingLegacy, setConnectingLegacy] = React.useState(false)

  // (Re)build the form whenever the wizard target changes.
  React.useEffect(() => {
    setError(null)
    if (!target) return
    const s = specs[target.provider]
    if (!s) return
    let saved: Record<string, string> = {}
    try { saved = JSON.parse(target.integration?.config || '{}') } catch { /* fresh connect */ }
    const init: Record<string, string> = {}
    for (const f of s.fields) init[f.key] = typeof saved[f.key] === 'string' ? saved[f.key] : ''
    setValues(init)
  }, [target, specs])

  if (!target) return null

  const isManaging = !!target.integration?.isConnected

  const save = async () => {
    if (!spec) return
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: target.provider, values }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || 'Could not save the connection')
      toast.success(`${spec.label} connected`, { description: 'Credentials validated and saved — running a test now…' })
      onClose()
      const rows = await onSaved()
      const row = rows.find((r: any) => r.provider === target.provider)
      if (row) runTest(row)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save the connection'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  const connectLegacy = async () => {
    setConnectingLegacy(true); setError(null)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: target.provider }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || 'Could not connect')
      toast.success(`${target.provider} connected`)
      onClose()
      await onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect')
    } finally {
      setConnectingLegacy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {spec ? (
          <>
            <DialogHeader>
              <DialogTitle>{isManaging ? `Manage ${spec.label}` : `Connect ${spec.label}`}</DialogTitle>
              <DialogDescription>{spec.tagline}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3">
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Setup steps</h4>
                <ol className="list-decimal space-y-1 pl-4 text-sm">
                  {spec.steps.map((s, idx) => <li key={idx} className="leading-relaxed">{s}</li>)}
                </ol>
                {spec.docsUrl && (
                  <a href={spec.docsUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80">
                    Open {spec.docsLabel ?? 'provider console'} <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              {spec.fields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`prov-${f.key}`}>{f.label}{f.required ? ' *' : ''}</Label>
                  <Input
                    id={`prov-${f.key}`}
                    type={f.type}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.type === 'password' && (values[f.key] ?? '') === REDACTED ? undefined : f.placeholder}
                    autoComplete="off"
                  />
                  {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
                </div>
              ))}
              {spec.fields.some((f) => f.type === 'password') && (
                <p className="text-xs text-muted-foreground">Secrets are stored server-side on the integration record and never returned in full — fields showing “{REDACTED}” keep the saved value.</p>
              )}
              {error && (
                <p className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"><CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {error}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <KeyRound className="mr-1.5 size-3.5" />}
                {isManaging ? 'Save credentials' : 'Save & connect'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Connect {target.provider.replace(/_/g, ' ')}</DialogTitle>
              <DialogDescription>This provider has no guided setup — connect it directly.</DialogDescription>
            </DialogHeader>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={connectLegacy} disabled={connectingLegacy}>{connectingLegacy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Plug className="mr-1.5 size-3.5" />} Connect</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface ApiImportFormState {
  endpointUrl: string
  method: 'GET' | 'POST'
  authType: 'none' | 'bearer' | 'basic' | 'header'
  authToken: string
  authUsername: string
  authPassword: string
  headerName: string
  targetModule: 'lead' | 'contact' | 'account' | 'deal'
  rowsPath: string
  fieldMapping: string
  scheduleMinutes: number
  updateExisting: boolean
}

const EMPTY_API_FORM: ApiImportFormState = {
  endpointUrl: '', method: 'GET', authType: 'none', authToken: '', authUsername: '', authPassword: '', headerName: '',
  targetModule: 'lead', rowsPath: '', fieldMapping: '', scheduleMinutes: 0, updateExisting: false,
}

function parseApiForm(configJson: string | undefined | null): ApiImportFormState {
  try {
    const c = configJson ? JSON.parse(configJson) : {}
    return {
      endpointUrl: String(c.endpointUrl ?? ''), method: c.method === 'POST' ? 'POST' : 'GET',
      authType: ['none', 'bearer', 'basic', 'header'].includes(c.authType) ? c.authType : 'none',
      authToken: String(c.authToken ?? ''), authUsername: String(c.authUsername ?? ''), authPassword: String(c.authPassword ?? ''),
      headerName: String(c.headerName ?? ''),
      targetModule: ['lead', 'contact', 'account', 'deal'].includes(c.targetModule) ? c.targetModule : 'lead',
      rowsPath: String(c.rowsPath ?? ''), fieldMapping: String(c.fieldMapping ?? ''),
      scheduleMinutes: Number(c.scheduleMinutes ?? 0) || 0,
      updateExisting: c.updateExisting === true,
    }
  } catch { return { ...EMPTY_API_FORM } }
}

const LOG_DOT: Record<string, string> = {
  success: 'bg-emerald-500', warning: 'bg-amber-500', error: 'bg-red-500', info: 'bg-muted-foreground/50',
}

/** Parse a fetch response as JSON; an HTML/empty body (e.g. a proxy error
 *  page) must never crash with "Unexpected token '<'". */
async function readJson(res: Response): Promise<any> {
  try { return await res.json() } catch { return null }
}

function ApiImportCard({ api, onOpenForm, onChanged }: { api: any | null; onOpenForm: () => void; onChanged: () => void }) {
  const [testing, setTesting] = React.useState(false)
  const [syncing, setSyncing] = React.useState(false)
  const [testResult, setTestResult] = React.useState<string | null>(null)
  const cfg = React.useMemo(() => parseApiForm(api?.config), [api])
  const logs: any[] = api?.logs ?? []

  const test = async () => {
    if (!api) return
    setTesting(true); setTestResult(null)
    try {
      const res = await fetch(`/api/integrations/${api.id}/test`, { method: 'POST' })
      const d = await readJson(res)
      if (!res.ok || !d) throw new Error(d?.error || d?.message || `Test failed (server error ${res.status})`)
      if (d.ok === false) throw new Error(d.message || 'Test failed')
      const unmapped = (d.unmappedSampleKeys ?? []).length > 0 ? ` Unmapped keys: ${(d.unmappedSampleKeys as string[]).slice(0, 5).join(', ')}.` : ''
      setTestResult(`✓ Reachable — ${d.sampleCount ?? d.rowCount ?? 0} row(s) found.${unmapped}`)
    } catch (e) {
      setTestResult(`✗ ${e instanceof Error ? e.message : 'Test failed'}`)
    } finally { setTesting(false) }
  }

  const syncNow = async () => {
    if (!api) return
    setSyncing(true)
    try {
      const res = await fetch(`/api/integrations/${api.id}/sync`, { method: 'POST' })
      const d = await readJson(res)
      if (!res.ok || !d) throw new Error(d?.error || `Sync failed (server error ${res.status})`)
      toast.success(`Imported — ${d.created} created, ${d.updated} updated, ${d.skipped} skipped, ${d.failed} failed`)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed')
    } finally { setSyncing(false) }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Globe className="size-4 text-primary" /> API Auto-Import</CardTitle>
          <CardDescription>Connect any HTTP endpoint that returns JSON — records flow in automatically, validated, deduped and assigned exactly like an import file.</CardDescription>
        </div>
        {!api && <Button size="sm" onClick={onOpenForm}><PlugZap className="mr-1.5 size-3.5" /> Connect API import</Button>}
      </CardHeader>
      {api && (
        <CardContent className="space-y-3">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <p className="truncate"><span className="text-muted-foreground">Endpoint:</span> <span className="font-mono text-xs">{cfg.endpointUrl || '—'}</span></p>
            <p><span className="text-muted-foreground">Target:</span> <span className="capitalize">{cfg.targetModule}</span>s</p>
            <p><span className="text-muted-foreground">Schedule:</span> {cfg.scheduleMinutes >= 15 ? `every ${cfg.scheduleMinutes} min` : 'Manual only'}</p>
            <p><span className="text-muted-foreground">Last synced:</span> {api.lastSyncedAt ? new Date(api.lastSyncedAt).toLocaleString() : 'never'}</p>
          </div>
          {testResult && <p className={`text-xs ${testResult.startsWith('✓') ? 'text-emerald-600' : 'text-destructive'}`}>{testResult}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={test} disabled={testing}>{testing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <FlaskConical className="mr-1.5 size-3.5" />} Test connection</Button>
            <Button size="sm" onClick={syncNow} disabled={syncing}>{syncing ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 size-3.5" />} Sync now</Button>
            <Button size="sm" variant="outline" onClick={onOpenForm}><Pencil className="mr-1.5 size-3.5" /> Edit</Button>
          </div>
          {logs.length > 0 && (
            <ul className="space-y-1 border-t pt-2">
              {logs.slice(0, 3).map((l) => (
                <li key={l.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={`inline-block size-1.5 shrink-0 rounded-full ${LOG_DOT[l.status] ?? LOG_DOT.info}`} aria-hidden />
                  <span className="truncate">{l.details ?? l.event}</span>
                  <span className="ml-auto shrink-0">{new Date(l.createdAt).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function ApiImportDialog({ open, onOpenChange, api, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; api: any | null; onSaved: () => void }) {
  const [form, setForm] = React.useState<ApiImportFormState>({ ...EMPTY_API_FORM })
  const [saving, setSaving] = React.useState(false)
  const [members, setMembers] = React.useState<{ id: string; name: string }[]>([])
  const [ownerId, setOwnerId] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setForm(api ? parseApiForm(api.config) : { ...EMPTY_API_FORM })
    fetch('/api/crm/members', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setMembers(d.members ?? []))
      .catch(() => {})
  }, [open, api])

  const set = <K extends keyof ApiImportFormState>(k: K, v: ApiImportFormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.endpointUrl.trim()) { toast.error('Endpoint URL is required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_api_import', config: { ...form, ownerId: ownerId || undefined } }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Save failed')
      toast.success('API import saved — use Test connection, then Sync now')
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>API Auto-Import</DialogTitle>
          <DialogDescription>Pull rows from any JSON endpoint into your CRM on a schedule.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="api-url">Endpoint URL *</Label>
            <Input id="api-url" value={form.endpointUrl} onChange={(e) => set('endpointUrl', e.target.value)} placeholder="https://api.example.com/v1/leads" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0 space-y-1">
              <Label>Method</Label>
              <Select value={form.method} onValueChange={(v) => set('method', v as 'GET' | 'POST')}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="GET">GET</SelectItem><SelectItem value="POST">POST</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label>Target module</Label>
              <Select value={form.targetModule} onValueChange={(v) => set('targetModule', v as ApiImportFormState['targetModule'])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Leads</SelectItem><SelectItem value="contact">Contacts</SelectItem>
                  <SelectItem value="account">Accounts</SelectItem><SelectItem value="deal">Deals</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0 space-y-1">
              <Label>Auth</Label>
              <Select value={form.authType} onValueChange={(v) => set('authType', v as ApiImportFormState['authType'])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem><SelectItem value="bearer">Bearer token</SelectItem>
                  <SelectItem value="basic">Basic user/password</SelectItem><SelectItem value="header">Custom header</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label>Auto-import</Label>
              <Select value={String(form.scheduleMinutes)} onValueChange={(v) => set('scheduleMinutes', Number(v))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Manual only</SelectItem>
                  <SelectItem value="15">Every 15 min</SelectItem>
                  <SelectItem value="60">Every hour</SelectItem>
                  <SelectItem value="360">Every 6 hours</SelectItem>
                  <SelectItem value="1440">Every day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.authType === 'bearer' && (
            <div className="space-y-1">
              <Label htmlFor="api-token">Bearer token</Label>
              <Input id="api-token" type="password" value={form.authToken} onChange={(e) => set('authToken', e.target.value)} placeholder={api ? '__SAVED__ keeps the stored token' : 'paste token'} />
            </div>
          )}
          {form.authType === 'basic' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="api-user">Username</Label><Input id="api-user" value={form.authUsername} onChange={(e) => set('authUsername', e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="api-pass">Password</Label><Input id="api-pass" type="password" value={form.authPassword} onChange={(e) => set('authPassword', e.target.value)} placeholder={api ? '__SAVED__ keeps the stored password' : ''} /></div>
            </div>
          )}
          {form.authType === 'header' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="api-hname">Header name</Label><Input id="api-hname" value={form.headerName} onChange={(e) => set('headerName', e.target.value)} placeholder="X-API-Key" /></div>
              <div className="space-y-1"><Label htmlFor="api-hval">Header value</Label><Input id="api-hval" type="password" value={form.authToken} onChange={(e) => set('authToken', e.target.value)} placeholder={api ? '__SAVED__ keeps the stored value' : ''} /></div>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="api-rows">Rows path</Label>
            <Input id="api-rows" value={form.rowsPath} onChange={(e) => set('rowsPath', e.target.value)} placeholder="data.items — leave empty if the response is the array itself" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="api-map">Field mapping (optional)</Label>
            <Textarea id="api-map" rows={3} value={form.fieldMapping} onChange={(e) => set('fieldMapping', e.target.value)} placeholder={'full_name=firstName\nemail_id=emails'} />
            <p className="text-xs text-muted-foreground">One per line: remote_key=crmField. Empty = auto-map (full_name, email_id, mobile_no and Listing Intelligence headers are recognized).</p>
          </div>
          {/* Whole row toggles the switch: label htmlFor + input id, ≥44px tall. */}
          <label htmlFor="api-update-existing" className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40">
            <span>
              <span className="block text-sm font-medium">Update existing records</span>
              <span className="block text-xs text-muted-foreground">Matched records are refreshed instead of skipped.</span>
            </span>
            <Switch id="api-update-existing" checked={form.updateExisting} onCheckedChange={(v) => set('updateExisting', v)} />
          </label>
          <div className="space-y-1">
            <Label>New records owned by</Label>
            <Select value={ownerId || 'me'} onValueChange={(v) => setOwnerId(v === 'me' ? '' : v)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="me">Me</SelectItem>
                {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null} Save connection</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface LineItemDraft { description: string; quantity: number; rate: number }

function InvoicingTab() {
  const [invoices, setInvoices] = React.useState<any[] | null>(null)
  const [form, setForm] = React.useState({ customerName: '', customerEmail: '' })
  const [items, setItems] = React.useState<LineItemDraft[]>([{ description: '', quantity: 1, rate: 0 }])
  const [creating, setCreating] = React.useState(false)
  const [generating, setGenerating] = React.useState(false)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const load = React.useCallback(async () => { const res = await fetch('/api/invoices', { cache: 'no-store' }); const d = await res.json(); setInvoices(d.invoices ?? []) }, [])
  React.useEffect(() => { load() }, [load])

  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.rate) || 0), 0)
  const tax = subtotal * 0.18
  const total = subtotal + tax
  const setItem = (idx: number, patch: Partial<LineItemDraft>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  const removeItem = (idx: number) =>
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev))

  const buildLineItems = () =>
    items
      .filter((i) => i.description.trim() || (Number(i.rate) || 0) > 0)
      .map((i) => ({
        description: i.description.trim() || 'Item',
        quantity: Math.max(0, Number(i.quantity) || 0),
        rate: Math.max(0, Number(i.rate) || 0),
      }))

  /** Shared create flow: POST /api/invoices, reset the form, refresh, return the created invoice. */
  const createOnServer = async (): Promise<any> => {
    const res = await fetch('/api/invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, lineItems: buildLineItems() }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error || 'Failed to create invoice')
    toast.success('Invoice created')
    setForm({ customerName: '', customerEmail: '' })
    setItems([{ description: '', quantity: 1, rate: 0 }])
    load()
    return json?.invoice ?? json ?? null
  }

  // Existing behavior kept: create the invoice only (no download).
  const create = async () => {
    if (!form.customerName.trim()) { toast.error('Customer name is required'); return }
    setCreating(true)
    try {
      await createOnServer()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create invoice')
    } finally {
      setCreating(false)
    }
  }

  // Primary action: create the invoice AND download the formatted PDF in the
  // same click — POST returns the invoice, the PDF is built client-side from it
  // and saved immediately. No preview/snapshot step, no new page.
  const generateInvoice = async () => {
    if (!form.customerName.trim()) { toast.error('Customer name is required'); return }
    const name = form.customerName.trim()
    const email = form.customerEmail.trim()
    setGenerating(true)
    try {
      const inv = await createOnServer()
      // Fallback if the API ever returns a bare shape — we have all values client-side.
      const doc = inv ?? {
        invoiceNumber: 'Invoice', customerName: name, customerEmail: email,
        status: 'draft', issueDate: new Date(), dueDate: new Date(Date.now() + 30 * 86400000),
        subtotal, tax, total, lineItems: buildLineItems(),
      }
      try {
        const blob = await invoicePdfBlob(doc)
        downloadBlob(blob, `${doc.invoiceNumber}.pdf`, { label: `Invoice ${doc.invoiceNumber} (PDF)` })
      } catch (pdfErr) {
        toast.error(pdfErr instanceof Error ? `PDF failed: ${pdfErr.message}` : 'PDF generation failed')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create invoice')
    } finally {
      setGenerating(false)
    }
  }

  const remove = async (inv: any) => {
    setDeletingId(inv.id)
    try {
      const res = await fetch(`/api/invoices/${inv.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Failed to delete invoice')
      toast.success('Invoice deleted')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete invoice')
    } finally {
      setDeletingId(null)
    }
  }

  const exportInvoice = async (inv: any, fmt: 'pdf' | 'docx') => {
    try {
      const blob = fmt === 'pdf' ? await invoicePdfBlob(inv) : await invoiceDocxBlob(inv)
      downloadBlob(blob, `${inv.invoiceNumber}.${fmt}`, { label: `Invoice ${inv.invoiceNumber} (${fmt.toUpperCase()})` })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-base">Invoices</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Customer name" value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} />
            <Input placeholder="Email (optional)" inputMode="email" value={form.customerEmail} onChange={e => setForm({ ...form, customerEmail: e.target.value })} />
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line items</p>
              <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => setItems((p) => [...p, { description: '', quantity: 1, rate: 0 }])}><Plus className="mr-1 size-3.5" /> Add line</Button>
            </div>
            {items.map((it, idx) => (
              <div key={idx} className="flex gap-2">
                <Input className="min-w-0 flex-1" placeholder="Description" value={it.description} onChange={e => setItem(idx, { description: e.target.value })} aria-label={`Item ${idx + 1} description`} />
                <Input className="w-16 shrink-0" type="number" min={0} placeholder="Qty" value={it.quantity} onChange={e => setItem(idx, { quantity: Number(e.target.value) })} aria-label={`Item ${idx + 1} quantity`} />
                <Input className="w-24 shrink-0" type="number" min={0} placeholder="Rate" value={it.rate} onChange={e => setItem(idx, { rate: Number(e.target.value) })} aria-label={`Item ${idx + 1} rate`} />
                <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeItem(idx)} disabled={items.length === 1} aria-label={`Remove item ${idx + 1}`}><Trash2 className="size-3.5" /></Button>
              </div>
            ))}
            <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 border-t pt-2 text-xs">
              <span className="text-muted-foreground">Subtotal <span className="font-medium text-foreground">{fmtINR(subtotal)}</span></span>
              <span className="text-muted-foreground">GST 18% <span className="font-medium text-foreground">{fmtINR(tax)}</span></span>
              <span className="font-semibold">Total {fmtINR(total)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={generateInvoice} disabled={generating || creating}>
              {generating ? <Loader2 className="mr-1 size-4 animate-spin" /> : <FileDown className="size-4" />} Generate Invoice
            </Button>
            <Button size="sm" variant="outline" onClick={create} disabled={creating || generating}>
              {creating ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Plus className="size-4" />} Create invoice
            </Button>
          </div>
        </div>
        {!invoices ? <Skeleton className="h-32 w-full" /> : invoices.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No invoices yet</p> :
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b text-xs uppercase text-muted-foreground"><tr><th className="px-2 py-2 text-left">Number</th><th className="px-2 py-2 text-left">Customer</th><th className="px-2 py-2 text-right">Total</th><th className="px-2 py-2 text-left">Status</th><th className="px-2 py-2 text-right">Actions</th></tr></thead><tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="border-b">
                    <td className="px-2 py-2 font-mono text-xs">{inv.invoiceNumber}</td>
                    <td className="px-2 py-2">{inv.customerName}</td>
                    <td className="px-2 py-2 text-right">{fmtINR(inv.total)}</td>
                    <td className="px-2 py-2"><Badge variant="outline" className="text-[10px] capitalize">{inv.status}</Badge></td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 px-2" aria-label={`Download ${inv.invoiceNumber}`}>
                              <Download className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => exportInvoice(inv, 'pdf')}>
                              <FileText className="mr-2 size-4" /> Download PDF
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => exportInvoice(inv, 'docx')}>
                              <FileDown className="mr-2 size-4" /> Download DOCX
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                              disabled={deletingId === inv.id}
                              aria-label={`Delete ${inv.invoiceNumber}`}
                            >
                              {deletingId === inv.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete invoice?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete {inv.invoiceNumber}? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => remove(inv)}
                                disabled={deletingId === inv.id}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody></table>
          </div>}
      </CardContent>
    </Card>
  )
}

function SupportTab() {
  const [tickets, setTickets] = React.useState<any[] | null>(null)
  const [form, setForm] = React.useState({ subject: '', description: '', priority: 'normal', requesterName: '' })
  const [creating, setCreating] = React.useState(false)
  const load = React.useCallback(async () => { const res = await fetch('/api/tickets', { cache: 'no-store' }); const d = await res.json(); setTickets(d.tickets ?? []) }, [])
  React.useEffect(() => { load() }, [load])
  const create = async () => {
    if (!form.subject.trim() || creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || 'Could not create ticket')
      toast.success('Ticket created')
      setForm({ subject: '', description: '', priority: 'normal', requesterName: '' })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create ticket')
    } finally {
      setCreating(false)
    }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Support Tickets</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2"><Input placeholder="Subject" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /><Input placeholder="Requester name" value={form.requesterName} onChange={e => setForm({ ...form, requesterName: e.target.value })} /></div>
        <Input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        <Button size="sm" onClick={create} disabled={creating}>{creating ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Plus className="mr-1 size-4" />} Create Ticket</Button>
        {!tickets ? <Skeleton className="h-32 w-full" /> : tickets.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No tickets</p> :
          <ul className="divide-y">{tickets.map(t => <li key={t.id} className="flex items-center gap-2 p-2"><span className="flex-1 text-sm font-medium">{t.subject}</span><Badge variant="outline" className="text-[10px] capitalize">{t.status}</Badge><Badge variant="outline" className="text-[10px] capitalize">{t.priority}</Badge></li>)}</ul>}
      </CardContent>
    </Card>
  )
}

function ProjectsTab() {
  const [projects, setProjects] = React.useState<any[] | null>(null)
  const [name, setName] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const load = React.useCallback(async () => { const res = await fetch('/api/projects', { cache: 'no-store' }); const d = await res.json(); setProjects(d.projects ?? []) }, [])
  React.useEffect(() => { load() }, [load])
  const create = async () => {
    if (!name.trim() || creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || 'Could not create project')
      toast.success('Project created')
      setName('')
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create project')
    } finally {
      setCreating(false)
    }
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Projects</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2"><Input placeholder="Project name" value={name} onChange={e => setName(e.target.value)} /><Button size="sm" onClick={create} disabled={creating}>{creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}</Button></div>
        {!projects ? <Skeleton className="h-32 w-full" /> : projects.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No projects yet</p> :
          <ul className="divide-y">{projects.map(p => <li key={p.id} className="flex items-center gap-2 p-2"><FolderKanban className="size-4 text-muted-foreground" /><span className="flex-1 text-sm font-medium">{p.name}</span><Badge variant="outline" className="text-[10px] capitalize">{p.status}</Badge></li>)}</ul>}
      </CardContent>
    </Card>
  )
}

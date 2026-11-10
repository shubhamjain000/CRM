'use client'

import * as React from 'react'
import {
  Search,
  PanelLeftClose,
  PanelLeft,
  LogOut,
  ChevronDown,
  ChevronRight,
  Check,
  Building2,
  ShieldCheck,
  Users,
  FileText,
  MonitorSmartphone,
  Cog,
  LayoutDashboard,
  Globe,
  Target,
  UserCircle,
  Briefcase,
  HandCoins,
  Settings2,
  Database,
  Trash2,
  ListTodo,
  Calendar,
  Phone,
  StickyNote,
  FolderOpen,
  Rss,
  GitBranch,
  AlertTriangle,
  BarChart3,
  Workflow,
  Zap,
  Activity,
  Code2,
  Mail,
  Inbox,
  Plug,
  Settings,
  Sparkles,
  Store,
  Megaphone,
  Package,
  Smartphone,
  Boxes,
  ScrollText,
  KeyRound,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SHORTCUTS_HELP } from '@/components/crm/use-keyboard-shortcuts'
import { useAuth } from '@/store/auth'
import { useI18n } from '@/i18n/provider'
import { localeNames, locales } from '@/i18n/config'
import { ThemeToggle } from '@/components/theme-toggle'
import { NotificationBell } from '@/components/realtime/notification-bell'
import { NotificationBanner } from '@/components/realtime/notification-banner'
import { PresenceList } from '@/components/realtime/presence-indicator'
import { CommandPalette } from './command-palette'
import { useIsMobile } from '@/hooks/use-mobile'

export type ViewKey =
  | 'overview' | 'mobile-app' | 'users' | 'roles' | 'audit' | 'devices' | 'security'
  | 'leads' | 'contacts' | 'accounts' | 'deals' | 'listings'
  | 'campaigns' | 'inventory'
  | 'custom-fields' | 'crm-setup'
  | 'api-keys'
  | 'trash'
  | 'tasks' | 'calendar' | 'calls'
  | 'notes' | 'files'
  | 'feed'
  | 'pipeline-manager' | 'at-risk' | 'pipeline-analytics'
  | 'blueprint-editor' | 'blueprint-dashboard'
  | 'approvals' | 'rules'
  | 'workflows' | 'workflow-dashboard'
  | 'custom-functions'
  | 'email' | 'telephony'
  | 'inbox' | 'channels'
  | 'reports' | 'analytics-dashboard'
  | 'exec-dashboard'
  | 'platform-settings'
  | 'module-builder'
  | 'ai-center'
  | 'ecosystem'
  | 'system-admin'

interface Props {
  view: ViewKey
  onViewChange: (v: ViewKey) => void
  collapsed: boolean
  onToggleCollapse: () => void
  children: React.ReactNode
}

export function DashboardShell({ view, onViewChange, collapsed, onToggleCollapse, children }: Props) {
  const t = useTranslations()
  const { user, organizations, switchOrg, logout } = useAuth()
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const isMobile = useIsMobile()
  const [mobileOpen, setMobileOpen] = React.useState(false)

  // Close the mobile drawer whenever the active view changes (incl. command palette nav)
  const handleViewChange = React.useCallback((v: ViewKey) => {
    onViewChange(v)
    setMobileOpen(false)
  }, [onViewChange])

  // Deep-link navigation from notifications: the bell and the mobile banner
  // dispatch 'unstop:navigate' with { view, module, recordId }.
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ view?: string }>).detail
      if (!detail?.view) return
      handleViewChange(detail.view as ViewKey)
    }
    window.addEventListener('unstop:navigate', handler)
    return () => window.removeEventListener('unstop:navigate', handler)
  }, [handleViewChange])

  const toggleSidebar = () => {
    if (isMobile) setMobileOpen((o) => !o)
    else onToggleCollapse()
  }

  // Full labels/wordmark show in the mobile drawer (always full-width) or desktop-expanded
  const showLabels = isMobile || !collapsed

  // App-frame scroll lock: while the shell is mounted the document itself must
  // never scroll — the sidebar rail and main area own all scrolling. Removed on
  // unmount so the landing/auth screens scroll normally again.
  React.useEffect(() => {
    document.documentElement.classList.add('app-frame')
    return () => document.documentElement.classList.remove('app-frame')
  }, [])

  // Escape closes the mobile drawer.
  React.useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  // Swipe-left inside the drawer closes it (a natural off-canvas gesture).
  const drawerTouch = React.useRef<{ x: number; y: number } | null>(null)
  const onDrawerTouchStart = (e: React.TouchEvent) => {
    const tch = e.touches[0]
    drawerTouch.current = { x: tch.clientX, y: tch.clientY }
  }
  const onDrawerTouchEnd = (e: React.TouchEvent) => {
    const start = drawerTouch.current
    drawerTouch.current = null
    if (!start || !mobileOpen) return
    const tch = e.changedTouches[0]
    const dx = tch.clientX - start.x
    const dy = tch.clientY - start.y
    if (dx < -56 && Math.abs(dx) > Math.abs(dy) * 1.5) setMobileOpen(false)
  }

  // Keyboard shortcuts help ('?') — uses the SHORTCUTS_HELP catalogue.
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = React.useState(false)

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      // '/' opens search/palette (unless typing in an input)
      const target = e.target as HTMLElement | null
      const isInput = !!target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      if (!isInput && e.key === '/') {
        e.preventDefault()
        setPaletteOpen(true)
        return
      }
      // '?' shows the keyboard shortcuts help
      if (!isInput && e.key === '?') {
        e.preventDefault()
        setShortcutsHelpOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Daily-work modules first (CRM), platform administration last — so the
  // sidebar opens showing the options people actually need, not a wall of
  // settings pushed far down the rail.
  const navSections: { title: string; items: { key: ViewKey; icon: React.ElementType; label: string }[] }[] = [
    {
      title: 'Home',
      items: [
        { key: 'overview', icon: LayoutDashboard, label: t('nav.overview') },
        { key: 'mobile-app', icon: Smartphone, label: 'Mobile App' },
      ],
    },
    {
      title: 'CRM',
      items: [
        { key: 'leads', icon: Target, label: 'Leads' },
        { key: 'contacts', icon: UserCircle, label: 'Contacts' },
        { key: 'accounts', icon: Briefcase, label: 'Accounts' },
        { key: 'deals', icon: HandCoins, label: 'Deals' },
        { key: 'listings', icon: ScrollText, label: 'Listings' },
        { key: 'campaigns', icon: Megaphone, label: 'Campaigns' },
        { key: 'inventory', icon: Package, label: 'Inventory' },
        { key: 'custom-fields', icon: Settings2, label: 'Custom Fields' },
        { key: 'crm-setup', icon: Database, label: 'Setup & Seed' },
        { key: 'trash', icon: Trash2, label: 'Trash' },
      ],
    },
    {
      title: 'Productivity',
      items: [
        { key: 'tasks', icon: ListTodo, label: 'Tasks' },
        { key: 'calendar', icon: Calendar, label: 'Calendar' },
        { key: 'calls', icon: Phone, label: 'Calls' },
      ],
    },
    {
      title: 'Content',
      items: [
        { key: 'notes', icon: StickyNote, label: 'Notes' },
        { key: 'files', icon: FolderOpen, label: 'Files' },
        { key: 'feed', icon: Rss, label: 'Feed' },
      ],
    },
    {
      title: 'Pipeline',
      items: [
        { key: 'pipeline-manager', icon: GitBranch, label: 'Pipelines' },
        { key: 'at-risk', icon: AlertTriangle, label: 'At Risk' },
        { key: 'pipeline-analytics', icon: BarChart3, label: 'Analytics' },
        { key: 'blueprint-editor', icon: Workflow, label: 'Blueprints' },
        { key: 'blueprint-dashboard', icon: LayoutDashboard, label: 'BP Dashboard' },
        { key: 'approvals', icon: ShieldCheck, label: 'Approvals' },
        { key: 'rules', icon: Cog, label: 'Rules' },
        { key: 'workflows', icon: Zap, label: 'Workflows' },
        { key: 'workflow-dashboard', icon: Activity, label: 'Exec Dashboard' },
        { key: 'custom-functions', icon: Code2, label: 'Functions' },
      ],
    },
    {
      title: 'Communication',
      items: [
        { key: 'email', icon: Mail, label: 'Email' },
        { key: 'telephony', icon: Phone, label: 'Telephony' },
        { key: 'inbox', icon: Inbox, label: 'Unified Inbox' },
        { key: 'channels', icon: Plug, label: 'Channels' },
      ],
    },
    {
      title: 'Analytics',
      items: [
        { key: 'reports', icon: FileText, label: 'Reports' },
        { key: 'analytics-dashboard', icon: BarChart3, label: 'Analytics' },
        { key: 'exec-dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      ],
    },
    {
      title: 'Administration',
      items: [
        { key: 'users', icon: Users, label: 'Users' },
        { key: 'roles', icon: ShieldCheck, label: 'Roles' },
        { key: 'audit', icon: FileText, label: 'Audit Log' },
        { key: 'devices', icon: MonitorSmartphone, label: 'Devices' },
        { key: 'security', icon: Cog, label: 'Security' },
        { key: 'api-keys', icon: KeyRound, label: t('nav.apiKeys') },
        { key: 'module-builder', icon: Boxes, label: 'Module Builder' },
        { key: 'platform-settings', icon: Settings, label: 'Platform' },
        { key: 'ai-center', icon: Sparkles, label: 'AI Center' },
        { key: 'ecosystem', icon: Store, label: 'Ecosystem' },
        { key: 'system-admin', icon: ShieldCheck, label: 'Admin' },
      ],
    },
  ]

  const initials = user?.name?.slice(0, 2).toUpperCase() ?? user?.email?.slice(0, 2).toUpperCase() ?? 'U'
  const currentOrg = organizations.find((o) => o.isCurrent) ?? organizations[0]

  // Breadcrumb source of truth: the nav label for the active ViewKey.
  const viewLabel = navSections.flatMap((s) => s.items).find((i) => i.key === view)?.label ?? view
  // Record segment: the record-nav store (src/store/record-nav.ts) tracks
  // record ids for prev/next navigation and palette deep-links, but does not
  // publish a display name for the open record. Once it does, the third
  // segment (`Workspace › Module › Record`) renders automatically — an opaque
  // id would be worse than no breadcrumb, so it stays off for now.
  const recordName: string | null = null

  return (
    <div className="app-frame-height glass-scene flex flex-col overflow-hidden bg-background">
      {/* Glass morphism aurora mesh — fixed, pointer-transparent tint layer that
          glows through every translucent surface (cards, chrome, floats). */}
      <div aria-hidden="true" className="glass-aurora" />
      {/* Mobile real-time notification banner — ONE instance for the whole app.
          Fixed to the top of the viewport, hidden on desktop (toasts there). */}
      <NotificationBanner />
      {/* Top bar — navy brand bar with a full search row on phones.
          The shell is a fixed app frame: the header and sidebar never scroll
          away, the sidebar options scroll in their own rail, and ONLY the
          main content area scrolls. */}
      <header className="on-navy z-30 shrink-0 border-b border-header-border bg-header/70 pt-[env(safe-area-inset-top)] text-header-foreground backdrop-blur-xl">
        <div className="flex h-14 items-center gap-2 overflow-x-hidden pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:pl-[max(1rem,env(safe-area-inset-left))] sm:pr-[max(1rem,env(safe-area-inset-right))]">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-9" onClick={toggleSidebar} aria-label={isMobile ? (mobileOpen ? 'Close menu' : 'Open menu') : (collapsed ? 'Expand sidebar' : 'Collapse sidebar')} aria-expanded={isMobile ? mobileOpen : !collapsed}>
                  {(isMobile ? mobileOpen : !collapsed) ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle sidebar</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Org switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2 font-normal">
                <div className="flex size-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="size-3.5" />
                </div>
                <span className="hidden max-w-[8rem] truncate lg:inline">
                  {currentOrg?.name ?? 'No org'}
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>{t('dashboard.switchOrg')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {organizations.map((o) => (
                <DropdownMenuItem key={o.id} onClick={() => switchOrg(o.id)} className="gap-2">
                  <Building2 className="size-3.5 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm">{o.name}</p>
                    <p className="text-xs text-muted-foreground">{o.role} · {o.membersCount} members</p>
                  </div>
                  {o.isCurrent && <Check className="size-3.5 text-emerald-500" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Search bar (desktop) — opens the global search palette */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-2 hidden h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground md:flex md:max-w-md"
            aria-label="Search records and pages"
          >
            <Search className="size-4 shrink-0" />
            <span className="flex-1 truncate text-left">Search leads, contacts, deals…</span>
            <kbd className="hidden shrink-0 rounded border border-border bg-background/80 px-1.5 py-0.5 text-[10px] font-mono sm:inline">Ctrl K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-1">
            {/* Language */}
            <LanguageMenu />
            <ThemeToggle />

            {/* Presence (who's online) */}
            <div className="hidden lg:block"><PresenceList /></div>

            {/* Notifications */}
            <NotificationBell />

            {/* Profile */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-1.5">
                  <Avatar className="size-7">
                    <AvatarFallback className="bg-primary/10 text-xs text-primary">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="hidden text-sm lg:inline">{user?.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="text-sm font-medium">{user?.name}</p>
                  <p className="truncate text-xs font-normal text-muted-foreground">{user?.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleViewChange('security')}>
                  <Cog className="mr-2 size-4" /> {t('nav.security')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleViewChange('devices')}>
                  <MonitorSmartphone className="mr-2 size-4" /> {t('nav.devices')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={logout}>
                  <LogOut className="mr-2 size-4" /> {t('dashboard.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Search bar row (phones + small tablets) */}
        <div className="flex h-[52px] items-center border-t border-border pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] md:hidden">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 text-sm text-muted-foreground transition active:bg-muted"
            aria-label="Search records and pages"
          >
            <Search className="size-4 shrink-0" />
            <span className="flex-1 truncate text-left">Search leads, contacts, deals…</span>
          </button>
        </div>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1">
        {/* Mobile backdrop — tap to close the drawer. Anchored to the row, so
            it always sits exactly below the header (no magic pixel offsets). */}
        {isMobile && mobileOpen && (
          <div
            className="absolute inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}
        {/* Sidebar — navy brand rail. On mobile it's an off-canvas drawer
            (absolute within the row, so it always fills the space below the
            header and slides in); on md+ it's an inline collapsible rail. */}
        <aside
          role={isMobile && mobileOpen ? 'dialog' : undefined}
          aria-modal={isMobile && mobileOpen ? true : undefined}
          aria-label="Main navigation"
          onTouchStart={onDrawerTouchStart}
          onTouchEnd={onDrawerTouchEnd}
          className={`bg-sidebar/80 text-sidebar-foreground border-r border-sidebar-border backdrop-blur-xl overflow-hidden
            absolute inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200 ease-out motion-reduce:transition-none
            ${mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
            md:static md:z-auto md:h-full md:translate-x-0 md:shadow-none md:transition-all md:duration-200 md:shrink-0
            ${collapsed ? 'md:w-14' : 'md:w-60'}`}
        >
          <nav className="nav-scroll flex h-full flex-col gap-0.5 overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {/* Wordmark — full in mobile drawer & desktop-expanded; compact only on desktop-collapsed */}
            {showLabels ? (
              <div className="flex items-center gap-2.5 border-b border-sidebar-border px-2 pb-3 pt-1">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary ring-1 ring-primary/15" aria-hidden>U</div>
                <div className="leading-tight">
                  <p className="brand-shimmer text-sm font-semibold tracking-tight">Unstop CRM</p>
                  <p className="text-[10px] font-medium uppercase tracking-widest text-sidebar-foreground/50">Sales &amp; Success</p>
                </div>
              </div>
            ) : (
              <div className="flex justify-center border-b border-sidebar-border pb-3 pt-1">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary ring-1 ring-primary/15" aria-hidden>U</div>
              </div>
            )}
            {navSections.map((section) => (
              <div key={section.title} className="mb-0.5">
                {showLabels && (
                  <p className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/45">
                    {section.title}
                  </p>
                )}
                {section.items.map((item) => {
                  const active = view === item.key
                  const Icon = item.icon
                  return (
                    <TooltipProvider key={item.key} delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => handleViewChange(item.key)}
                            className={`relative flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all duration-150 active:bg-sidebar-accent md:min-h-0 md:py-1.5 md:text-[13px] md:active:bg-transparent ${
                              active
                                ? 'bg-primary/10 font-medium text-primary before:absolute before:left-0 before:top-1/2 before:h-5 before:-translate-y-1/2 before:w-[3px] before:rounded-full before:bg-primary'
                                : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                            } ${showLabels ? '' : 'md:justify-center md:px-0'}`}
                            aria-current={active ? 'page' : undefined}
                          >
                            <Icon className={`size-4 shrink-0 transition-transform duration-150 ${active ? 'scale-110' : ''}`} />
                            <span className={`truncate ${showLabels ? '' : 'md:hidden'}`}>{item.label}</span>
                          </button>
                        </TooltipTrigger>
                        {!showLabels && <TooltipContent side="right">{item.label}</TooltipContent>}
                      </Tooltip>
                    </TooltipProvider>
                  )
                })}
              </div>
            ))}
            <div className="mt-auto p-2">
              <Badge variant="outline" className={`justify-center border-sidebar-border text-xs text-sidebar-foreground/70 ${showLabels ? 'w-full' : 'md:w-auto'}`}>
                {currentOrg?.role ?? 'member'}
              </Badge>
            </div>
          </nav>
        </aside>

        {/* Main content — the ONLY scroll container in the app frame */}
        <main className="main-scroll min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-canvas/60">
          {/* Breadcrumbs — compact path under the sticky header. Not sticky
              on purpose: record/detail views pin their own "Back to <Module>"
              bar at the top of this scroll area, and a sticky breadcrumb would
              paint over it (the animated view wrapper creates a stacking
              context below the breadcrumb's). The shell header above never
              scrolls away, so wayfinding persists on every view. */}
          <nav aria-label="Breadcrumb" className="border-b bg-canvas/60 px-4 py-2 sm:px-6 lg:px-8">
            <ol className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <li className="hidden max-w-[9rem] truncate sm:block">
                {currentOrg?.name ?? 'Workspace'}
              </li>
              <li aria-hidden="true" className="hidden sm:block">
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
              </li>
              <li className="min-w-0 max-w-[12rem] truncate sm:max-w-[14rem]">{viewLabel}</li>
              {recordName && (
                <>
                  <li aria-hidden="true">
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
                  </li>
                  <li className="min-w-0 flex-1 truncate font-medium text-foreground/80">
                    {recordName}
                  </li>
                </>
              )}
            </ol>
          </nav>
          <div key={view} className="view-enter anim-fade-up mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onNavigate={(v) => handleViewChange(v as ViewKey)} />

      {/* Keyboard shortcuts help — '?' */}
      <Dialog open={shortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Work faster without leaving the keyboard.</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-1.5 overflow-y-auto">
            {SHORTCUTS_HELP.map((s) => (
              <div key={s.keys} className="flex items-center justify-between gap-4 rounded-md border px-3 py-1.5">
                <span className="text-sm text-muted-foreground">{s.desc}</span>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LanguageMenu() {
  const { locale, setLocale } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9">
          <Globe className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-40 overflow-y-auto">
        <DropdownMenuLabel>Language</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {locales.map((l) => (
          <DropdownMenuItem key={l} onClick={() => setLocale(l)} className="gap-2">
            <span className="flex-1">{localeNames[l]}</span>
            {locale === l && <Check className="size-3.5 text-emerald-500" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

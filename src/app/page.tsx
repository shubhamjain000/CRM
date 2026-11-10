'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/store/auth'
import { LandingPage } from '@/components/auth/landing'
import { AuthCard } from '@/components/auth/auth-card'
import { DashboardShell, type ViewKey } from '@/components/dashboard/dashboard-shell'
import { OverviewView } from '@/components/dashboard/views/overview'
// Heavy views load lazily (same pattern as below) — keeping them out of the
// initial `/` graph is what keeps the dev server's memory footprint sane on
// this 4GB box (the OOM killer previously took down next-server at ~2.9GB).
const MobileAppView = dynamic(() => import('@/components/mobile/views/mobile-app').then(mod => ({ default: mod.MobileAppView })))
const UsersView = dynamic(() => import('@/components/dashboard/views/users').then(mod => ({ default: mod.UsersView })))
const RolesView = dynamic(() => import('@/components/dashboard/views/roles').then(mod => ({ default: mod.RolesView })))
const AuditView = dynamic(() => import('@/components/dashboard/views/audit').then(mod => ({ default: mod.AuditView })))
const DevicesView = dynamic(() => import('@/components/dashboard/views/devices').then(mod => ({ default: mod.DevicesView })))
const SecurityView = dynamic(() => import('@/components/dashboard/views/security').then(mod => ({ default: mod.SecurityView })))
const ApiKeysView = dynamic(() => import('@/components/dashboard/views/api-keys').then(mod => ({ default: mod.ApiKeysView })))
const LeadsView = dynamic(() => import('@/components/crm/views/leads').then(mod => ({ default: mod.LeadsView })))
const ContactsView = dynamic(() => import('@/components/crm/views/contacts').then(mod => ({ default: mod.ContactsView })))
const AccountsView = dynamic(() => import('@/components/crm/views/accounts').then(mod => ({ default: mod.AccountsView })))
const DealsView = dynamic(() => import('@/components/crm/views/deals').then(mod => ({ default: mod.DealsView })))
const CampaignsView = dynamic(() => import('@/components/crm/views/campaigns').then(mod => ({ default: mod.CampaignsView })))
const ListingsView = dynamic(() => import('@/components/crm/views/listings').then(mod => ({ default: mod.ListingsView })))
const InventoryView = dynamic(() => import('@/components/inventory/inventory-view').then(mod => ({ default: mod.InventoryView })))
const CustomFieldsView = dynamic(() => import('@/components/crm/views/custom-fields').then(mod => ({ default: mod.CustomFieldsView })))
const CrmSetupView = dynamic(() => import('@/components/crm/views/setup').then(mod => ({ default: mod.CrmSetupView })))
const TrashView = dynamic(() => import('@/components/crm/views/trash').then(mod => ({ default: mod.TrashView })))
const TasksView = dynamic(() => import('@/components/productivity/views/tasks').then(mod => ({ default: mod.TasksView })))
const CalendarView = dynamic(() => import('@/components/productivity/views/calendar').then(mod => ({ default: mod.CalendarView })))
const CallsView = dynamic(() => import('@/components/productivity/views/calls').then(mod => ({ default: mod.CallsView })))
const CallTracker = dynamic(() => import('@/components/crm/call-dialer').then(mod => ({ default: mod.CallTracker })))
const NotesView = dynamic(() => import('@/components/content/views/notes').then(mod => ({ default: mod.NotesView })))
const FilesView = dynamic(() => import('@/components/content/views/files').then(mod => ({ default: mod.FilesView })))
const FeedView = dynamic(() => import('@/components/feed/views/feed').then(mod => ({ default: mod.FeedView })))
const PipelineManagerView = dynamic(() => import('@/components/pipeline/views/pipeline-manager').then(mod => ({ default: mod.PipelineManagerView })))
const AtRiskView = dynamic(() => import('@/components/pipeline/views/at-risk').then(mod => ({ default: mod.AtRiskView })))
const PipelineAnalyticsView = dynamic(() => import('@/components/pipeline/views/analytics').then(mod => ({ default: mod.PipelineAnalyticsView })))
const BlueprintEditorView = dynamic(() => import('@/components/blueprint/views/editor').then(mod => ({ default: mod.BlueprintEditorView })))
const BlueprintDashboardView = dynamic(() => import('@/components/blueprint/views/dashboard').then(mod => ({ default: mod.BlueprintDashboardView })))
const ApprovalCenterView = dynamic(() => import('@/components/rule-engine/views/approval-center').then(mod => ({ default: mod.ApprovalCenterView })))
const RuleBuilderView = dynamic(() => import('@/components/rule-engine/views/rule-builder').then(mod => ({ default: mod.RuleBuilderView })))
const WorkflowBuilderView = dynamic(() => import('@/components/workflow/views/builder').then(mod => ({ default: mod.WorkflowBuilderView })))
const WorkflowDashboardView = dynamic(() => import('@/components/workflow/views/dashboard').then(mod => ({ default: mod.WorkflowDashboardView })))
const FunctionEditorView = dynamic(() => import('@/components/custom-functions/views/editor').then(mod => ({ default: mod.FunctionEditorView })))
const EmailView = dynamic(() => import('@/components/email/views/inbox').then(mod => ({ default: mod.EmailView })))
const TelephonyView = dynamic(() => import('@/components/telephony/views/telephony').then(mod => ({ default: mod.TelephonyView })))
const UnifiedInboxView = dynamic(() => import('@/components/inbox/views/unified-inbox').then(mod => ({ default: mod.UnifiedInboxView })))
const ChannelsView = dynamic(() => import('@/components/channels/views/channels').then(mod => ({ default: mod.ChannelsView })))
const ReportBuilderView = dynamic(() => import('@/components/reports/views/report-builder').then(mod => ({ default: mod.ReportBuilderView })))
const AnalyticsDashboardView = dynamic(() => import('@/components/reports/views/analytics-dashboard').then(mod => ({ default: mod.AnalyticsDashboardView })))
const ExecutiveDashboardView = dynamic(() => import('@/components/dashboard-widgets/executive-dashboard').then(mod => ({ default: mod.ExecutiveDashboardView })))
const PlatformSettingsView = dynamic(() => import('@/components/customization/views/platform-settings').then(mod => ({ default: mod.PlatformSettingsView })))
const AICenterView = dynamic(() => import('@/components/ai/views/ai-center').then(mod => ({ default: mod.AICenterView })))
import { ZiaChatbotLazy } from '@/components/ai/zia-chatbot-lazy'
const EcosystemView = dynamic(() => import('@/components/ecosystem/views/ecosystem').then(mod => ({ default: mod.EcosystemView })))
const SystemAdminView = dynamic(() => import('@/components/finalize/views/system-admin').then(mod => ({ default: mod.SystemAdminView })))
import { RealtimeProvider } from '@/components/productivity/realtime-provider'
import { ErrorBoundary } from '@/components/error-boundary'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { AuthFetchInterceptor } from '@/lib/auth/client-fetch'
const GmailConnectorResultToast = dynamic(() => import('@/components/channels/views/channels').then(mod => ({ default: mod.GmailConnectorResultToast })))

type Screen = 'landing' | 'auth' | 'app' | 'session-error'

export default function Home() {
  const { user, loading, fetchMe } = useAuth()
  const [screen, setScreen] = React.useState<Screen>('landing')
  const [authMode, setAuthMode] = React.useState<'signin' | 'signup'>('signin')
  const [view, setView] = React.useState<ViewKey>('overview')
  const [collapsed, setCollapsed] = React.useState(false)

  React.useEffect(() => {
    fetchMe()
  }, [fetchMe])

  // Once we know the session state, pick the screen.
  React.useEffect(() => {
    if (loading) return
    setScreen(user ? 'app' : screen === 'app' ? 'landing' : screen)
  }, [user, loading])

  const startAuth = (mode: 'signin' | 'signup') => {
    setAuthMode(mode)
    setScreen('auth')
  }

  const onAuthed = async (token?: string) => {
    // Store bearer token in memory as a fallback for when cookies are blocked
    // (embedded previews with third-party cookie restrictions)
    if (token) useAuth.getState().setBearerToken(token)
    const ok = await fetchMe(token)
    if (ok && useAuth.getState().user) {
      setScreen('app')
    } else {
      setScreen('session-error')
    }
  }

  const retrySession = async () => {
    const ok = await fetchMe()
    if (ok && useAuth.getState().user) setScreen('app')
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="space-y-4 text-center">
          <Skeleton className="mx-auto size-12 rounded-xl" />
          <Skeleton className="mx-auto h-4 w-40" />
          <Skeleton className="mx-auto h-3 w-24" />
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <AuthFetchInterceptor />
      <GmailConnectorResultToast />
      {screen === 'landing' && (
        <LandingPage onGetStarted={() => startAuth('signup')} onSignIn={() => startAuth('signin')} />
      )}
      {screen === 'session-error' && (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
              <AlertTriangle className="size-6" />
            </div>
            <h1 className="text-lg font-semibold">Session could not be established</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your account was created, but the session cookie was blocked — this happens in
              embedded previews that restrict third-party cookies.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Button asChild>
                <a href="/" target="_blank" rel="noopener">
                  <ExternalLink className="mr-2 size-4" /> Open app in a new tab
                </a>
              </Button>
              <Button variant="outline" onClick={retrySession}>Try again</Button>
              <Button variant="ghost" onClick={() => setScreen('auth')}>Back to sign in</Button>
            </div>
          </div>
        </div>
      )}
      {screen === 'auth' && (
        <AuthCard
          initialMode={authMode}
          onBack={() => setScreen('landing')}
          onAuthed={onAuthed}
        />
      )}
      {screen === 'app' && user && (
        <RealtimeProvider userId={user.id}>
          <DashboardShell
            view={view}
            onViewChange={setView}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((c) => !c)}
          >
            <ErrorBoundary key={view}>
              {view === 'overview' && <OverviewView />}
              {view === 'mobile-app' && <MobileAppView />}
              {view === 'users' && <UsersView />}
              {view === 'roles' && <RolesView />}
              {view === 'audit' && <AuditView />}
              {view === 'devices' && <DevicesView />}
              {view === 'security' && <SecurityView />}
              {view === 'api-keys' && <ApiKeysView />}
              {view === 'leads' && <LeadsView />}
              {view === 'contacts' && <ContactsView />}
              {view === 'accounts' && <AccountsView />}
              {view === 'deals' && <DealsView />}
              {view === 'listings' && <ListingsView />}
              {view === 'campaigns' && <CampaignsView />}
              {view === 'inventory' && <InventoryView />}
              {view === 'custom-fields' && <CustomFieldsView />}
              {view === 'crm-setup' && <CrmSetupView />}
              {view === 'trash' && <TrashView />}
              {view === 'tasks' && <TasksView />}
              {view === 'calendar' && <CalendarView />}
              {view === 'calls' && <CallsView />}
              {view === 'notes' && <NotesView />}
              {view === 'files' && <FilesView />}
              {view === 'feed' && <FeedView />}
              {view === 'pipeline-manager' && <PipelineManagerView />}
              {view === 'at-risk' && <AtRiskView />}
              {view === 'pipeline-analytics' && <PipelineAnalyticsView />}
              {view === 'blueprint-editor' && <BlueprintEditorView />}
              {view === 'blueprint-dashboard' && <BlueprintDashboardView />}
              {view === 'approvals' && <ApprovalCenterView />}
              {view === 'rules' && <RuleBuilderView />}
              {view === 'workflows' && <WorkflowBuilderView />}
              {view === 'workflow-dashboard' && <WorkflowDashboardView />}
              {view === 'custom-functions' && <FunctionEditorView />}
              {view === 'email' && <EmailView />}
              {view === 'telephony' && <TelephonyView />}
              {view === 'inbox' && <UnifiedInboxView />}
              {view === 'channels' && <ChannelsView />}
              {view === 'reports' && <ReportBuilderView />}
              {view === 'analytics-dashboard' && <AnalyticsDashboardView />}
              {view === 'exec-dashboard' && <ExecutiveDashboardView />}
              {view === 'platform-settings' && <PlatformSettingsView />}
              {view === 'module-builder' && <PlatformSettingsView initialTab="modules" />}
              {view === 'ai-center' && <AICenterView />}
              {view === 'ecosystem' && <EcosystemView />}
              {view === 'system-admin' && <SystemAdminView />}
            </ErrorBoundary>
          </DashboardShell>
          <ZiaChatbotLazy />
          {/* Auto call logger — watches tel: dialer returns app-wide */}
          <CallTracker />
        </RealtimeProvider>
      )}
    </ErrorBoundary>
  )
}

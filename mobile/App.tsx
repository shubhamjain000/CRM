import { StatusBar } from 'expo-status-bar'
import React from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

/**
 * Unstop CRM — native iOS + Android app (Expo / React Native).
 *
 * Talks to the same backend as the web app: cookie-session login, leads,
 * tasks and platform stats. Point it at a reachable server with
 * EXPO_PUBLIC_API_URL (defaults to http://localhost:3000 for simulator use).
 */

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'
const NAVY = '#223558'
const NAVY_DARK = '#1B2A45'
const EMERALD = '#10B981'
const AMBER = '#F59E0B'
const RED = '#EF4444'
const INK = '#0F172A'
const MUTED = '#64748B'
const LINE = '#E2E8F0'
const BG = '#F6F7F9'

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`)
  return data
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Lead {
  id: string
  firstName: string
  lastName: string
  company: string | null
  leadStatus: string
  leadSource: string
  phones: string
}

interface Task {
  id: string
  title: string
  dueDate: string | null
  priority: string
  status: string
}

interface Stats {
  total: number
  overdue: number
  completed: number
  inProgress: number
  notStarted: number
}

type Tab = 'home' | 'leads' | 'tasks' | 'more'

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function LoginScreen({ onSignedIn }: { onSignedIn: (email: string) => void }) {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const signIn = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      })
      onSignedIn(email.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.loginWrap} keyboardShouldPersistTaps="handled">
        <View style={styles.logoTile}>
          <Text style={styles.logoText}>U</Text>
        </View>
        <Text style={styles.loginTitle}>Unstop CRM</Text>
        <Text style={styles.loginSubtitle}>Sales, Cadence &amp; Success Platform</Text>

        <View style={styles.loginCard}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@company.com"
            placeholderTextColor={MUTED}
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={MUTED}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable style={[styles.primaryBtn, busy && styles.disabled]} onPress={signIn} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Sign in</Text>}
          </Pressable>
          <Text style={styles.hint}>Server: {API_BASE}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function HomeScreen() {
  const [stats, setStats] = React.useState<Stats | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await api('/api/productivity/stats')
      setStats(d.stats ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const cards: Array<{ label: string; value: number | undefined; color: string }> = [
    { label: 'Total tasks', value: stats?.total, color: NAVY },
    { label: 'Overdue', value: stats?.overdue, color: RED },
    { label: 'In progress', value: stats?.inProgress, color: AMBER },
    { label: 'Completed', value: stats?.completed, color: EMERALD },
  ]

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.screenPad}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={NAVY} />}
    >
      <Text style={styles.screenTitle}>Today</Text>
      <Text style={styles.screenSubtitle}>Your workspace at a glance</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.kpiGrid}>
        {cards.map((c) => (
          <View key={c.label} style={styles.kpiCard}>
            <Text style={[styles.kpiValue, { color: c.color }]}>{stats ? c.value ?? 0 : '—'}</Text>
            <Text style={styles.kpiLabel}>{c.label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Connected</Text>
        <Text style={styles.infoBody}>
          This app talks to the same secure API as the web platform — sessions, tenant scoping and
          audit logging included. Pull down to refresh.
        </Text>
      </View>
    </ScrollView>
  )
}

function LeadsScreen() {
  const [leads, setLeads] = React.useState<Lead[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await api('/api/crm/leads?limit=50')
      setLeads(d.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leads')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  return (
    <View style={styles.flex}>
      {error ? (
        <Text style={[styles.errorText, styles.screenPad]}>{error}</Text>
      ) : (
        <FlatList
          style={styles.flex}
          contentContainerStyle={styles.listPad}
          data={leads ?? []}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={NAVY} />}
          ListEmptyComponent={
            loading ? null : <Text style={styles.emptyText}>No leads yet — pull to refresh.</Text>
          }
          renderItem={({ item }) => {
            const name = `${item.firstName ?? ''} ${item.lastName ?? ''}`.trim() || 'Unnamed lead'
            const phone = parseJsonArray(item.phones)[0]
            return (
              <View style={styles.rowCard}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.rowSubtitle} numberOfLines={1}>
                    {item.company ?? 'No company'}
                    {phone ? ` · ${phone}` : ''}
                  </Text>
                </View>
                <View style={[styles.chip, { borderColor: LINE }]}>
                  <Text style={styles.chipText}>{item.leadStatus ?? 'new'}</Text>
                </View>
              </View>
            )
          }}
        />
      )}
    </View>
  )
}

function TasksScreen() {
  const [tasks, setTasks] = React.useState<Task[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = await api('/api/productivity/tasks?limit=50')
      setTasks(d.tasks ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const priorityColor = (p: string): string =>
    p === 'urgent' || p === 'high' ? RED : p === 'normal' ? NAVY : MUTED

  return (
    <View style={styles.flex}>
      {error ? (
        <Text style={[styles.errorText, styles.screenPad]}>{error}</Text>
      ) : (
        <FlatList
          style={styles.flex}
          contentContainerStyle={styles.listPad}
          data={tasks ?? []}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={NAVY} />}
          ListEmptyComponent={
            loading ? null : <Text style={styles.emptyText}>No tasks yet — pull to refresh.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.rowCard}>
              <View style={[styles.statusDot, { backgroundColor: priorityColor(item.priority ?? 'low') }]} />
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.rowSubtitle}>
                  Due {fmtDate(item.dueDate)} · {item.status ?? 'open'}
                </Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  )
}

function MoreScreen({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.screenPad}>
      <Text style={styles.screenTitle}>More</Text>
      <Text style={styles.screenSubtitle}>Account &amp; app</Text>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Signed in</Text>
        <Text style={styles.infoBody}>{email}</Text>
      </View>
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Server</Text>
        <Text style={styles.infoBody}>{API_BASE}</Text>
      </View>
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Version</Text>
        <Text style={styles.infoBody}>Unstop CRM 1.0.0 · iOS + Android (Expo)</Text>
      </View>

      <Pressable style={styles.signOutBtn} onPress={onSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  )
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'home', label: 'Home' },
  { key: 'leads', label: 'Leads' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'more', label: 'More' },
]

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <View style={styles.tabBar}>
      {TABS.map((t) => {
        const isActive = t.key === active
        return (
          <Pressable key={t.key} style={styles.tabItem} onPress={() => onChange(t.key)}>
            <View style={[styles.tabPill, isActive && { backgroundColor: NAVY }]}>
              <Text style={[styles.tabLabel, isActive && { color: '#fff' }]}>{t.label}</Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

export default function App() {
  const [email, setEmail] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState<Tab>('home')

  return (
    <View style={styles.app}>
      <StatusBar style="light" backgroundColor={NAVY} />
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLogo}>
          <Text style={styles.headerLogoText}>U</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.headerTitle}>Unstop CRM</Text>
          <Text style={styles.headerSubtitle}>Sales · Cadence · Success</Text>
        </View>
      </View>

      {/* Body */}
      <View style={styles.flex}>
        {!email ? (
          <LoginScreen onSignedIn={setEmail} />
        ) : (
          <>
            {tab === 'home' && <HomeScreen />}
            {tab === 'leads' && <LeadsScreen />}
            {tab === 'tasks' && <TasksScreen />}
            {tab === 'more' && <MoreScreen email={email} onSignOut={() => { setEmail(null); setTab('home') }} />}
          </>
        )}
      </View>

      {email ? <TabBar active={tab} onChange={setTab} /> : null}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: { flex: 1 },
  app: { flex: 1, backgroundColor: BG },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: NAVY,
    paddingTop: 54,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLogoText: { color: NAVY, fontSize: 20, fontWeight: '800' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerSubtitle: { color: 'rgba(255,255,255,0.65)', fontSize: 11, marginTop: 1 },

  // Login
  loginWrap: { flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: BG },
  logoTile: {
    width: 76,
    height: 76,
    borderRadius: 20,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  logoText: { color: '#fff', fontSize: 40, fontWeight: '800' },
  loginTitle: { fontSize: 24, fontWeight: '800', color: INK, textAlign: 'center', marginTop: 14 },
  loginSubtitle: { fontSize: 13, color: MUTED, textAlign: 'center', marginTop: 4 },
  loginCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginTop: 22,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  label: { fontSize: 12, fontWeight: '600', color: MUTED, marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: INK,
    backgroundColor: '#fff',
  },
  errorText: { color: RED, fontSize: 13, marginTop: 10 },
  primaryBtn: {
    backgroundColor: NAVY,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  hint: { fontSize: 11, color: MUTED, textAlign: 'center', marginTop: 12 },

  // Screens
  screenPad: { padding: 16, paddingBottom: 28 },
  screenTitle: { fontSize: 22, fontWeight: '800', color: INK },
  screenSubtitle: { fontSize: 13, color: MUTED, marginTop: 2, marginBottom: 14 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiCard: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: LINE,
  },
  kpiValue: { fontSize: 26, fontWeight: '800' },
  kpiLabel: { fontSize: 12, color: MUTED, marginTop: 2 },
  infoCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginTop: 10, borderWidth: 1, borderColor: LINE },
  infoTitle: { fontSize: 13, fontWeight: '700', color: INK },
  infoBody: { fontSize: 13, color: MUTED, marginTop: 4 },

  // Lists
  listPad: { padding: 16, paddingBottom: 28 },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: LINE,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: INK },
  rowSubtitle: { fontSize: 12, color: MUTED, marginTop: 2 },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 10, color: MUTED, textTransform: 'capitalize', fontWeight: '600' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  emptyText: { textAlign: 'center', color: MUTED, marginTop: 32, fontSize: 13 },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: LINE,
    backgroundColor: '#fff',
    paddingTop: 6,
    paddingBottom: 22,
    paddingHorizontal: 8,
  },
  tabItem: { flex: 1, alignItems: 'center' },
  tabPill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  tabLabel: { fontSize: 12, fontWeight: '700', color: MUTED },

  // More
  signOutBtn: {
    marginTop: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: RED,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  signOutText: { color: RED, fontSize: 14, fontWeight: '700' },
})

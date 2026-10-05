import { useCallback, useEffect, useRef, useState } from 'react'
import { api, LOCKED_EVENT_NAME } from './api'
import { JournalDataProvider, useJournalData } from './journalData'
import { navigateTo, useRoute } from './router'
import { SetupScreen, UnlockScreen } from './screens/AccessScreens'
import { EntriesScreen } from './screens/EntriesScreen'
import { EntryDetailScreen } from './screens/EntryDetailScreen'
import { EntryEditor } from './screens/EntryEditor'
import { InsightsScreen } from './screens/InsightsScreen'
import { TagsScreen } from './screens/TagsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { ReportScreen } from './screens/ReportScreen'
import type { VaultStatus } from '../shared/model'

export function App() {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.getStatus())
      setStatusError(null)
    } catch {
      setStatusError('Cannot reach the server. Check that it is running, then reload.')
    }
  }, [])

  useEffect(() => {
    void loadStatus()
    const handleLocked = () => setStatus((previous) => (previous ? { ...previous, unlocked: false } : previous))
    window.addEventListener(LOCKED_EVENT_NAME, handleLocked)
    return () => window.removeEventListener(LOCKED_EVENT_NAME, handleLocked)
  }, [loadStatus])

  if (statusError) return <main className="access-screen"><p className="form-error">{statusError}</p></main>
  if (!status) return <main className="access-screen" aria-busy="true" />
  if (!status.vaultInitialized) return <SetupScreen onReady={() => void loadStatus()} />
  if (!status.unlocked) return <UnlockScreen totpEnabled={status.totpEnabled} onUnlocked={() => void loadStatus()} />

  const lockNow = async () => {
    await api.lock().catch(() => undefined)
    setStatus({ ...status, unlocked: false })
  }

  return (
    // Unmounting this provider on lock drops every decrypted record from memory.
    <JournalDataProvider>
      <UnlockedShell status={status} onStatusChange={() => void loadStatus()} onLock={() => void lockNow()} />
    </JournalDataProvider>
  )
}

function UnlockedShell({ status, onStatusChange, onLock }: { status: VaultStatus; onStatusChange: () => void; onLock: () => void }) {
  const route = useRoute()
  const { entries, isLoading } = useJournalData()
  const [isObscured, setIsObscured] = useState(false)

  // Held in a ref so re-renders don't restart the idle clock.
  const onLockRef = useRef(onLock)
  onLockRef.current = onLock

  // Lock locally on idle too, so an open tab doesn't keep showing records after the server session ends.
  useEffect(() => {
    let lastActivityMilliseconds = Date.now()
    const markActivity = () => (lastActivityMilliseconds = Date.now())
    const activityEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }))
    const idleCheckTimer = window.setInterval(() => {
      if (Date.now() - lastActivityMilliseconds > status.sessionIdleMinutes * 60_000) onLockRef.current()
    }, 15_000)
    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity))
      window.clearInterval(idleCheckTimer)
    }
  }, [status.sessionIdleMinutes])

  // Blur content while the app is in the background, so app-switcher snapshots don't show records.
  useEffect(() => {
    const handleVisibility = () => setIsObscured(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  const isEditing = route.screen === 'new-entry' || route.screen === 'edit-entry'
  const routedEntry =
    route.screen === 'entry' || route.screen === 'edit-entry' ? entries.find((entry) => entry.id === route.entryId) : undefined

  let screenContent
  if (route.screen === 'new-entry') screenContent = <EntryEditor key="new" />
  else if ((route.screen === 'entry' || route.screen === 'edit-entry') && !routedEntry) {
    screenContent = isLoading ? (
      <p className="screen-message">Opening your journal…</p>
    ) : (
      <div className="screen empty-state">
        <h1>Record not found</h1>
        <p>It may have been deleted on another device.</p>
        <a className="button button-secondary" href="#/entries">
          Back to records
        </a>
      </div>
    )
  } else if (route.screen === 'edit-entry') screenContent = <EntryEditor key={routedEntry!.id} existingEntry={routedEntry} />
  else if (route.screen === 'entry') screenContent = <EntryDetailScreen entry={routedEntry!} />
  else if (route.screen === 'insights') screenContent = <InsightsScreen />
  else if (route.screen === 'tags') screenContent = <TagsScreen />
  else if (route.screen === 'report') screenContent = <ReportScreen />
  else if (route.screen === 'settings') screenContent = <SettingsScreen status={status} onStatusChange={onStatusChange} onLock={onLock} />
  else screenContent = <EntriesScreen />

  const activeTab =
    route.screen === 'insights' || route.screen === 'report' ? 'insights' : route.screen === 'tags' ? 'tags' : route.screen === 'settings' ? 'settings' : 'entries'

  return (
    <div className={`app-shell${isEditing ? ' is-editing' : ''}${isObscured ? ' is-obscured' : ''}`}>
      {!isEditing && (
        <nav className="app-nav" aria-label="Main">
          <a className="app-nav-brand" href="#/entries">
            Reframe
          </a>
          <a className="app-nav-link" href="#/entries" aria-current={activeTab === 'entries' ? 'page' : undefined}>
            <NavIcon name="entries" />
            <span>Records</span>
          </a>
          <a className="app-nav-link" href="#/insights" aria-current={activeTab === 'insights' ? 'page' : undefined}>
            <NavIcon name="insights" />
            <span>Insights</span>
          </a>
          <button type="button" className="app-nav-log" onClick={() => navigateTo('/log')}>
            <NavIcon name="log" />
            <span>Log</span>
          </button>
          <a className="app-nav-link" href="#/tags" aria-current={activeTab === 'tags' ? 'page' : undefined}>
            <NavIcon name="tags" />
            <span>Tags</span>
          </a>
          <a className="app-nav-link" href="#/settings" aria-current={activeTab === 'settings' ? 'page' : undefined}>
            <NavIcon name="settings" />
            <span>Settings</span>
          </a>
        </nav>
      )}
      <main className="app-main">{screenContent}</main>
    </div>
  )
}

function NavIcon({ name }: { name: 'entries' | 'insights' | 'log' | 'tags' | 'settings' }) {
  const paths: Record<typeof name, string> = {
    entries: 'M5 6h14M5 12h14M5 18h9',
    insights: 'M4 18l5-6 4 3 7-9',
    log: 'M12 5v14M5 12h14',
    tags: 'M4 12V5h7l8 8-7 7-8-8z M8.5 8.5h.01',
    settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  }
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}

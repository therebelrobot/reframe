import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { RecoveryCodeNotice } from '../components/RecoveryCodeNotice'
import { formatFullTimestamp } from '../format'
import type { AuditEvent, VaultStatus } from '../../shared/model'

const AUDIT_EVENT_LABELS: Record<string, string> = {
  vault_created: 'Journal created',
  unlocked: 'Unlocked',
  unlock_failed: 'Wrong passphrase or code',
  locked: 'Locked',
  recovered_with_recovery_code: 'Recovery code used',
  recovery_failed: 'Wrong recovery code',
  passphrase_changed: 'Passphrase changed',
  recovery_code_replaced: 'New recovery code made',
  authenticator_enabled: 'Authenticator turned on',
  authenticator_disabled: 'Authenticator turned off',
  exported_json: 'Exported (JSON)',
  exported_csv: 'Exported (CSV)',
  report_prepared: 'Report printed or saved',
  exported_guava_csv: 'Exported for Guava (CSV)',
}

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

export function SettingsScreen({ status, onStatusChange, onLock }: { status: VaultStatus; onStatusChange: () => void; onLock: () => void }) {
  return (
    <div className="screen settings">
      <header className="screen-header">
        <h1>Settings</h1>
      </header>
      <section className="settings-panel">
        <h2>Lock</h2>
        <p>The journal locks itself after {status.sessionIdleMinutes} minutes without activity, and whenever the server restarts.</p>
        <button type="button" className="button button-primary" onClick={onLock}>
          Lock now
        </button>
      </section>
      <ChangePassphrasePanel />
      <AuthenticatorPanel totpEnabled={status.totpEnabled} onStatusChange={onStatusChange} />
      <RecoveryCodePanel />
      <ExportPanel />
      <AccessLogPanel />
    </div>
  )
}

function ChangePassphrasePanel() {
  const [currentPassphrase, setCurrentPassphrase] = useState('')
  const [newPassphrase, setNewPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)
  const [isWorking, setIsWorking] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (newPassphrase !== confirmPassphrase) return setMessage({ tone: 'error', text: 'The new passphrases do not match.' })
    setIsWorking(true)
    try {
      await api.changePassphrase(currentPassphrase, newPassphrase)
      setCurrentPassphrase('')
      setNewPassphrase('')
      setConfirmPassphrase('')
      setMessage({ tone: 'ok', text: 'Passphrase changed. Other devices have been signed out.' })
    } catch (error) {
      setMessage({ tone: 'error', text: errorMessageOf(error, 'Could not change the passphrase.') })
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <section className="settings-panel">
      <h2>Passphrase</h2>
      <p>Your passphrase is the encryption key. Changing it re-wraps the key; your records stay as they are.</p>
      <form className="stacked-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Current passphrase</span>
          <input type="password" autoComplete="current-password" value={currentPassphrase} onChange={(event) => setCurrentPassphrase(event.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">New passphrase</span>
          <input type="password" autoComplete="new-password" minLength={12} value={newPassphrase} onChange={(event) => setNewPassphrase(event.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">New passphrase again</span>
          <input type="password" autoComplete="new-password" minLength={12} value={confirmPassphrase} onChange={(event) => setConfirmPassphrase(event.target.value)} required />
        </label>
        <button type="submit" className="button button-secondary" disabled={isWorking}>
          {isWorking ? 'Changing…' : 'Change passphrase'}
        </button>
        {message && <p className={message.tone === 'error' ? 'form-error' : 'form-ok'} role="status">{message.text}</p>}
      </form>
    </section>
  )
}

function AuthenticatorPanel({ totpEnabled, onStatusChange }: { totpEnabled: boolean; onStatusChange: () => void }) {
  const [enrollment, setEnrollment] = useState<{ secretBase32: string; otpauthUri: string } | null>(null)
  const [code, setCode] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)

  const begin = async () => {
    try {
      setEnrollment(await api.beginAuthenticatorSetup())
      setMessage(null)
    } catch (error) {
      setMessage({ tone: 'error', text: errorMessageOf(error, 'Could not start setup.') })
    }
  }

  const confirm = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await api.confirmAuthenticatorSetup(code)
      setEnrollment(null)
      setCode('')
      setMessage({ tone: 'ok', text: 'Authenticator is on. You will need a code each time you unlock.' })
      onStatusChange()
    } catch (error) {
      setMessage({ tone: 'error', text: errorMessageOf(error, 'That code did not work.') })
    }
  }

  const disable = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await api.disableAuthenticator(passphrase)
      setPassphrase('')
      setMessage({ tone: 'ok', text: 'Authenticator is off.' })
      onStatusChange()
    } catch (error) {
      setMessage({ tone: 'error', text: errorMessageOf(error, 'Could not turn it off.') })
    }
  }

  return (
    <section className="settings-panel">
      <h2>Authenticator code</h2>
      {totpEnabled ? (
        <>
          <p>On. Unlocking needs your passphrase and a 6-digit code.</p>
          <form className="stacked-form" onSubmit={disable}>
            <label className="field">
              <span className="field-label">Passphrase, to turn it off</span>
              <input type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required />
            </label>
            <button type="submit" className="button button-secondary">
              Turn off authenticator
            </button>
          </form>
        </>
      ) : enrollment ? (
        <form className="stacked-form" onSubmit={confirm}>
          <p>
            On this phone, <a href={enrollment.otpauthUri}>open it in your authenticator app</a>. On another device, add
            this key by hand:
          </p>
          <p className="secret-key">{enrollment.secretBase32.match(/.{1,4}/g)!.join(' ')}</p>
          <label className="field">
            <span className="field-label">Code from the app</span>
            <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} required />
          </label>
          <button type="submit" className="button button-primary">
            Turn on authenticator
          </button>
        </form>
      ) : (
        <>
          <p>Off. Add a 6-digit code from an authenticator app as a second step when unlocking.</p>
          <button type="button" className="button button-secondary" onClick={() => void begin()}>
            Set up authenticator
          </button>
        </>
      )}
      {message && <p className={message.tone === 'error' ? 'form-error' : 'form-ok'} role="status">{message.text}</p>}
    </section>
  )
}

function RecoveryCodePanel() {
  const [passphrase, setPassphrase] = useState('')
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      const { recoveryCode } = await api.replaceRecoveryCode(passphrase)
      setPassphrase('')
      setNewRecoveryCode(recoveryCode)
      setErrorText(null)
    } catch (error) {
      setErrorText(errorMessageOf(error, 'Could not make a new recovery code.'))
    }
  }

  return (
    <section className="settings-panel">
      <h2>Recovery code</h2>
      {newRecoveryCode ? (
        <RecoveryCodeNotice recoveryCode={newRecoveryCode} onDone={() => setNewRecoveryCode(null)} />
      ) : (
        <>
          <p>Make a new one if the old code may have been seen. The old code stops working immediately.</p>
          <form className="stacked-form" onSubmit={submit}>
            <label className="field">
              <span className="field-label">Passphrase</span>
              <input type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required />
            </label>
            <button type="submit" className="button button-secondary">
              Make a new recovery code
            </button>
            {errorText && <p className="form-error" role="alert">{errorText}</p>}
          </form>
        </>
      )}
    </section>
  )
}

function ExportPanel() {
  return (
    <section className="settings-panel">
      <h2>Export</h2>
      <p>Downloads are not encrypted. Store or share them as carefully as the journal itself.</p>
      <div className="button-row">
        <a className="button button-primary" href="#/report">
          Make a report
        </a>
        <a className="button button-secondary" href="/api/export?format=csv" download>
          Download CSV
        </a>
        <a className="button button-secondary" href="/api/export?format=json" download>
          Download JSON
        </a>
      </div>
    </section>
  )
}

function AccessLogPanel() {
  const [auditEvents, setAuditEvents] = useState<AuditEvent[] | null>(null)
  useEffect(() => {
    api.listAuditEvents().then(setAuditEvents, () => setAuditEvents([]))
  }, [])
  return (
    <section className="settings-panel">
      <h2>Recent access</h2>
      {auditEvents === null ? (
        <p>Loading…</p>
      ) : (
        <ul className="audit-list">
          {auditEvents.slice(0, 25).map((auditEvent) => (
            <li key={auditEvent.id} className={auditEvent.event.endsWith('_failed') ? 'audit-warning' : undefined}>
              <span className="audit-event">{AUDIT_EVENT_LABELS[auditEvent.event] ?? auditEvent.event}</span>
              <span className="audit-meta">
                {formatFullTimestamp(auditEvent.at)}, from {auditEvent.ipAddress}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

import { useId, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { RecoveryCodeNotice } from '../components/RecoveryCodeNotice'

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

function Wordmark() {
  return (
    <div className="wordmark" aria-hidden="true">
      <svg viewBox="0 0 48 48" width="44" height="44">
        <circle className="wordmark-ring" cx="24" cy="24" r="17" />
        <path className="wordmark-turn" d="M24 7a17 17 0 0 1 17 17" />
      </svg>
    </div>
  )
}

export function SetupScreen({ onReady }: { onReady: () => void }) {
  const [setupToken, setSetupToken] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const fieldIdPrefix = useId()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (passphrase !== confirmPassphrase) return setErrorText('The passphrases do not match.')
    setIsWorking(true)
    try {
      const result = await api.setUp(setupToken, passphrase)
      setPassphrase('')
      setConfirmPassphrase('')
      setRecoveryCode(result.recoveryCode)
    } catch (error) {
      setErrorText(errorMessageOf(error, 'Setup failed.'))
    } finally {
      setIsWorking(false)
    }
  }

  if (recoveryCode) {
    return (
      <main className="access-screen">
        <Wordmark />
        <RecoveryCodeNotice recoveryCode={recoveryCode} onDone={onReady} />
      </main>
    )
  }

  return (
    <main className="access-screen">
      <Wordmark />
      <h1>Set up your journal</h1>
      <p>Choose a passphrase. It encrypts everything you write, so a long one you can type easily on your phone works best.</p>
      <form className="stacked-form" onSubmit={submit}>
        <div className="field">
          <label className="field-label" htmlFor={`${fieldIdPrefix}-token`}>
            Setup token
          </label>
          <input
            id={`${fieldIdPrefix}-token`}
            aria-describedby={`${fieldIdPrefix}-token-hint`}
            value={setupToken}
            onChange={(event) => setSetupToken(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            required
          />
          <span className="field-hint" id={`${fieldIdPrefix}-token-hint`}>
            Printed in the server log on first start, or set with REFRAME_SETUP_TOKEN.
          </span>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${fieldIdPrefix}-passphrase`}>
            Passphrase
          </label>
          <input
            id={`${fieldIdPrefix}-passphrase`}
            aria-describedby={`${fieldIdPrefix}-passphrase-hint`}
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            required
          />
          <span className="field-hint" id={`${fieldIdPrefix}-passphrase-hint`}>
            At least 12 characters. Four or five unrelated words is a good shape.
          </span>
        </div>
        <label className="field">
          <span className="field-label">Passphrase again</span>
          <input type="password" autoComplete="new-password" minLength={12} value={confirmPassphrase} onChange={(event) => setConfirmPassphrase(event.target.value)} required />
        </label>
        <button type="submit" className="button button-primary" disabled={isWorking}>
          {isWorking ? 'Creating encryption keys…' : 'Create journal'}
        </button>
        {errorText && <p className="form-error" role="alert">{errorText}</p>}
      </form>
    </main>
  )
}

export function UnlockScreen({ totpEnabled, onUnlocked }: { totpEnabled: boolean; onUnlocked: () => void }) {
  const [mode, setMode] = useState<'unlock' | 'recover'>('unlock')
  const [passphrase, setPassphrase] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('')
  const [newPassphrase, setNewPassphrase] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [replacementRecoveryCode, setReplacementRecoveryCode] = useState<string | null>(null)

  const unlock = async (event: FormEvent) => {
    event.preventDefault()
    setIsWorking(true)
    try {
      await api.unlock(passphrase, totpEnabled ? totpCode : undefined)
      setPassphrase('')
      onUnlocked()
    } catch (error) {
      setErrorText(errorMessageOf(error, 'Could not unlock.'))
      setTotpCode('')
    } finally {
      setIsWorking(false)
    }
  }

  const recover = async (event: FormEvent) => {
    event.preventDefault()
    setIsWorking(true)
    try {
      const result = await api.recover(recoveryCodeInput, newPassphrase)
      setNewPassphrase('')
      setRecoveryCodeInput('')
      setReplacementRecoveryCode(result.recoveryCode)
    } catch (error) {
      setErrorText(errorMessageOf(error, 'Recovery failed.'))
    } finally {
      setIsWorking(false)
    }
  }

  if (replacementRecoveryCode) {
    return (
      <main className="access-screen">
        <Wordmark />
        <p>You are back in. Your old recovery code no longer works, and the authenticator was turned off. Here is a new code.</p>
        <RecoveryCodeNotice recoveryCode={replacementRecoveryCode} onDone={onUnlocked} />
      </main>
    )
  }

  return (
    <main className="access-screen">
      <Wordmark />
      {mode === 'unlock' ? (
        <>
          <h1>Unlock</h1>
          <form className="stacked-form" onSubmit={unlock}>
            <label className="field">
              <span className="field-label">Passphrase</span>
              <input type="password" autoComplete="current-password" autoFocus value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required />
            </label>
            {totpEnabled && (
              <label className="field">
                <span className="field-label">Authenticator code</span>
                <input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={totpCode} onChange={(event) => setTotpCode(event.target.value)} required />
              </label>
            )}
            <button type="submit" className="button button-primary" disabled={isWorking}>
              {isWorking ? 'Unlocking…' : 'Unlock'}
            </button>
            {errorText && <p className="form-error" role="alert">{errorText}</p>}
          </form>
          <button
            type="button"
            className="link-button access-switch"
            onClick={() => {
              setMode('recover')
              setErrorText(null)
            }}
          >
            Forgot passphrase or lost your authenticator?
          </button>
        </>
      ) : (
        <>
          <h1>Use your recovery code</h1>
          <p>This sets a new passphrase and turns off the authenticator. You will get a new recovery code afterwards.</p>
          <form className="stacked-form" onSubmit={recover}>
            <label className="field">
              <span className="field-label">Recovery code</span>
              <input value={recoveryCodeInput} onChange={(event) => setRecoveryCodeInput(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} required />
            </label>
            <label className="field">
              <span className="field-label">New passphrase</span>
              <input type="password" autoComplete="new-password" minLength={12} value={newPassphrase} onChange={(event) => setNewPassphrase(event.target.value)} required />
            </label>
            <button type="submit" className="button button-primary" disabled={isWorking}>
              {isWorking ? 'Recovering…' : 'Recover journal'}
            </button>
            {errorText && <p className="form-error" role="alert">{errorText}</p>}
          </form>
          <button
            type="button"
            className="link-button access-switch"
            onClick={() => {
              setMode('unlock')
              setErrorText(null)
            }}
          >
            Back to unlock
          </button>
        </>
      )}
    </main>
  )
}

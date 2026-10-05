import { useState } from 'react'

/** Shown once, right after a recovery code is created. The server keeps only a wrapped key, never the code. */
export function RecoveryCodeNotice({ recoveryCode, onDone }: { recoveryCode: string; onDone: () => void }) {
  const [hasConfirmedSaving, setHasConfirmedSaving] = useState(false)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCode)
      setCopyMessage('Copied. Paste it into your password manager, then clear your clipboard.')
    } catch {
      setCopyMessage('Copy is blocked here. Write the code down instead.')
    }
  }

  return (
    <div className="recovery-notice">
      <h2>Your recovery code</h2>
      <p>
        If you forget your passphrase or lose your authenticator, this code is the only way back in. Nobody, including
        whoever runs the server, can reset it for you.
      </p>
      <p className="recovery-code" aria-label="Recovery code">
        {recoveryCode}
      </p>
      <button type="button" className="button button-secondary" onClick={() => void copyCode()}>
        Copy code
      </button>
      {copyMessage && <p className="field-hint">{copyMessage}</p>}
      <label className="checkbox-field">
        <input type="checkbox" checked={hasConfirmedSaving} onChange={(event) => setHasConfirmedSaving(event.target.checked)} />
        <span>I saved it somewhere safe, away from this device</span>
      </label>
      <button type="button" className="button button-primary" disabled={!hasConfirmedSaving} onClick={onDone}>
        Continue
      </button>
    </div>
  )
}

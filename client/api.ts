import type { AuditEvent, Entry, EntryInput, Tag, TagInput, VaultStatus } from '../shared/model'

export type TagWithUsage = Tag & { usageCount: number }

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message)
  }
}

/** Fired whenever the server says the session is gone, so the app can show the lock screen. */
export const LOCKED_EVENT_NAME = 'reframe:locked'

async function request<ResponseBody>(method: string, urlPath: string, body?: unknown): Promise<ResponseBody> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (method !== 'GET') headers['x-reframe-request'] = '1'
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(urlPath, {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      error?: string
      message?: string
      retryAfterSeconds?: number
    }
    if (response.status === 401 && errorBody.error === 'locked') {
      window.dispatchEvent(new Event(LOCKED_EVENT_NAME))
    }
    throw new ApiError(
      response.status,
      errorBody.error ?? 'unknown',
      errorBody.message ?? `Request failed (${response.status}).`,
      errorBody.retryAfterSeconds,
    )
  }
  return (await response.json()) as ResponseBody
}

export const api = {
  getStatus: () => request<VaultStatus>('GET', '/api/status'),
  setUp: (setupToken: string, passphrase: string) =>
    request<{ recoveryCode: string }>('POST', '/api/setup', { setupToken, passphrase }),
  unlock: (passphrase: string, totpCode?: string) => request<{ ok: true }>('POST', '/api/login', { passphrase, totpCode }),
  recover: (recoveryCode: string, newPassphrase: string) =>
    request<{ recoveryCode: string }>('POST', '/api/recover', { recoveryCode, newPassphrase }),
  lock: () => request<{ ok: true }>('POST', '/api/logout'),

  listEntries: () => request<Entry[]>('GET', '/api/entries'),
  createEntry: (entryInput: EntryInput) => request<Entry>('POST', '/api/entries', entryInput),
  replaceEntry: (entryId: string, entryInput: EntryInput) => request<Entry>('PUT', `/api/entries/${entryId}`, entryInput),
  deleteEntry: (entryId: string) => request<{ ok: true }>('DELETE', `/api/entries/${entryId}`),

  listTags: () => request<TagWithUsage[]>('GET', '/api/tags'),
  createTag: (tagInput: TagInput) => request<Tag>('POST', '/api/tags', tagInput),
  replaceTag: (tagId: string, tagInput: TagInput) => request<Tag>('PUT', `/api/tags/${tagId}`, tagInput),
  deleteTag: (tagId: string) => request<{ ok: true }>('DELETE', `/api/tags/${tagId}`),

  recordClientExport: (kind: 'report' | 'guava_csv') => request<{ ok: true }>('POST', '/api/audit/client-export', { kind }),
  listAuditEvents: () => request<AuditEvent[]>('GET', '/api/audit'),
  changePassphrase: (currentPassphrase: string, newPassphrase: string) =>
    request<{ ok: true }>('POST', '/api/passphrase', { currentPassphrase, newPassphrase }),
  replaceRecoveryCode: (passphrase: string) => request<{ recoveryCode: string }>('POST', '/api/recovery-code', { passphrase }),
  beginAuthenticatorSetup: () => request<{ secretBase32: string; otpauthUri: string }>('POST', '/api/totp/begin'),
  confirmAuthenticatorSetup: (code: string) => request<{ ok: true }>('POST', '/api/totp/confirm', { code }),
  disableAuthenticator: (passphrase: string) => request<{ ok: true }>('POST', '/api/totp/disable', { passphrase }),
}

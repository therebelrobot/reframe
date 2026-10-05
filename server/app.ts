import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { getConnInfo } from '@hono/node-server/conninfo'
import { z } from 'zod'
import type { Database } from './database'
import type { ServerConfig } from './config'
import { SessionStore, type UnlockedSession } from './sessions'
import { UnlockRateLimiter } from './rateLimiter'
import { VaultError, VaultService } from './vault'
import { buildOtpauthUri } from './crypto/totp'
import {
  AuditLog,
  EntryRepository,
  RecordConflictError,
  RecordNotFoundError,
  RecordValidationError,
  TagRepository,
  assertEntryTagReferencesAreValid,
  countTagUsage,
} from './repositories'
import {
  changePassphraseRequestSchema,
  clientExportAuditSchema,
  entryInputSchema,
  loginRequestSchema,
  passphraseConfirmationSchema,
  recoverRequestSchema,
  setupRequestSchema,
  tagInputSchema,
  totpConfirmRequestSchema,
} from './schemas'
import { buildEntriesCsv } from './csvExport'
import type { StaticAsset } from './staticAssets'
import type { VaultStatus } from '../shared/model'

type AppEnvironment = { Variables: { session: UnlockedSession } }

/** Header every state-changing request must carry; browsers won't send it cross-site without a CORS preflight we never grant. */
export const REQUIRED_REQUEST_HEADER = 'x-reframe-request'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export interface ApplicationDependencies {
  config: ServerConfig
  database: Database
  staticAssets: Map<string, StaticAsset>
  currentTimeMilliseconds?: () => number
  logSetupToken?: (setupToken: string) => void
}

export function createApplication(dependencies: ApplicationDependencies) {
  const { config, database, staticAssets } = dependencies
  const currentTimeMilliseconds = dependencies.currentTimeMilliseconds ?? Date.now
  const nowIso = () => new Date(currentTimeMilliseconds()).toISOString()

  const vault = new VaultService(database, config.scryptParameters, currentTimeMilliseconds)
  const sessions = new SessionStore(
    config.sessionIdleMinutes * 60_000,
    config.sessionMaxHours * 3_600_000,
    currentTimeMilliseconds,
  )
  const unlockRateLimiter = new UnlockRateLimiter(currentTimeMilliseconds)
  const tagRepository = new TagRepository(database)
  const entryRepository = new EntryRepository(database)
  const auditLog = new AuditLog(database)

  // __Host- cookies must be Secure, Path=/ and have no Domain: they can't be
  // set or shadowed by any other subdomain.
  const sessionCookieName = config.cookieSecure ? '__Host-reframe_session' : 'reframe_session'

  const app = new Hono<AppEnvironment>()

  // ---------- helpers ----------

  const clientIpAddress = (context: Context): string => {
    if (config.trustProxy) {
      // Take the hop our trusted proxy appended (rightmost), not the client-supplied leftmost one.
      const forwardedFor = context.req.header('x-forwarded-for')
      const proxyAppendedAddress = forwardedFor?.split(',').map((part) => part.trim()).filter(Boolean).at(-1)
      if (proxyAppendedAddress) return proxyAppendedAddress
    }
    try {
      return getConnInfo(context).remote.address ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  const userAgentOf = (context: Context) => context.req.header('user-agent') ?? ''

  const audit = (context: Context, event: string) => auditLog.record(event, clientIpAddress(context), userAgentOf(context), nowIso())

  const startSession = (context: Context, dataEncryptionKey: Buffer) => {
    const { sessionToken } = sessions.create(dataEncryptionKey)
    dataEncryptionKey.fill(0)
    setCookie(context, sessionCookieName, sessionToken, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'Strict',
      path: '/',
      maxAge: config.sessionMaxHours * 3600,
    })
  }

  const endSession = (context: Context) => {
    sessions.destroy(getCookie(context, sessionCookieName))
    deleteCookie(context, sessionCookieName, { path: '/', secure: config.cookieSecure })
  }

  const rejectIfRateLimited = (context: Context) => {
    const retryAfterMilliseconds = unlockRateLimiter.retryAfterMilliseconds(clientIpAddress(context))
    if (retryAfterMilliseconds > 0) {
      const retryAfterSeconds = Math.ceil(retryAfterMilliseconds / 1000)
      context.header('Retry-After', String(retryAfterSeconds))
      return context.json(
        { error: 'rate_limited', message: `Too many attempts. Try again in ${formatWait(retryAfterSeconds)}.`, retryAfterSeconds },
        429,
      )
    }
    return null
  }

  const readJsonBody = async <Schema extends z.ZodType>(context: Context, schema: Schema): Promise<z.infer<Schema>> =>
    schema.parse(await context.req.json().catch(() => ({})))

  // ---------- global headers ----------

  app.use('*', async (context, next) => {
    await next()
    context.header('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    context.header('X-Content-Type-Options', 'nosniff')
    context.header('X-Frame-Options', 'DENY')
    context.header('Referrer-Policy', 'no-referrer')
    context.header('Cross-Origin-Opener-Policy', 'same-origin')
    context.header('Cross-Origin-Resource-Policy', 'same-origin')
    context.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()')
    context.header('X-Robots-Tag', 'noindex, nofollow, noarchive')
    if (config.cookieSecure) context.header('Strict-Transport-Security', 'max-age=31536000')
  })

  // ---------- API guards ----------

  app.use('/api/*', bodyLimit({ maxSize: 256 * 1024 }))

  app.use('/api/*', async (context, next) => {
    context.header('Cache-Control', 'no-store')
    context.header('Pragma', 'no-cache')
    const method = context.req.method
    if (method !== 'GET' && method !== 'HEAD') {
      if (context.req.header(REQUIRED_REQUEST_HEADER) !== '1') {
        return context.json({ error: 'forbidden', message: 'Missing request header.' }, 403)
      }
      const originHeader = context.req.header('origin')
      if (originHeader) {
        const expectedOrigin = config.publicOrigin ?? `${config.cookieSecure ? 'https' : 'http'}://${context.req.header('host')}`
        if (originHeader !== expectedOrigin) {
          return context.json({ error: 'forbidden', message: 'Cross-origin request refused.' }, 403)
        }
      }
    }
    await next()
  })

  // ---------- public API ----------

  app.get('/api/status', (context) => {
    const status: VaultStatus = {
      vaultInitialized: vault.isInitialized(),
      unlocked: sessions.touch(getCookie(context, sessionCookieName)) !== null,
      totpEnabled: vault.isTotpEnabled(),
      sessionIdleMinutes: config.sessionIdleMinutes,
    }
    return context.json(status)
  })

  app.post('/api/setup', async (context) => {
    const rateLimitedResponse = rejectIfRateLimited(context)
    if (rateLimitedResponse) return rateLimitedResponse
    const setupRequest = await readJsonBody(context, setupRequestSchema)
    if (vault.isInitialized()) throw new VaultError('vault_exists', 'This journal is already set up.')
    if (setupRequest.setupToken.trim() !== config.setupToken) {
      unlockRateLimiter.recordFailure(clientIpAddress(context))
      return context.json({ error: 'wrong_setup_token', message: 'That setup token is not right. Check the server log.' }, 401)
    }
    const { dataEncryptionKey, recoveryCode } = await vault.initialize(setupRequest.passphrase)
    tagRepository.seedDefaults(dataEncryptionKey, nowIso())
    audit(context, 'vault_created')
    startSession(context, dataEncryptionKey)
    return context.json({ recoveryCode })
  })

  app.post('/api/login', async (context) => {
    const rateLimitedResponse = rejectIfRateLimited(context)
    if (rateLimitedResponse) return rateLimitedResponse
    const loginRequest = await readJsonBody(context, loginRequestSchema)
    try {
      const dataEncryptionKey = await vault.unlockWithPassphrase(loginRequest.passphrase, loginRequest.totpCode || undefined)
      unlockRateLimiter.recordSuccess(clientIpAddress(context))
      audit(context, 'unlocked')
      startSession(context, dataEncryptionKey)
      return context.json({ ok: true })
    } catch (error) {
      if (error instanceof VaultError && error.code === 'wrong_credentials') {
        unlockRateLimiter.recordFailure(clientIpAddress(context))
        audit(context, 'unlock_failed')
      }
      throw error
    }
  })

  app.post('/api/recover', async (context) => {
    const rateLimitedResponse = rejectIfRateLimited(context)
    if (rateLimitedResponse) return rateLimitedResponse
    const recoverRequest = await readJsonBody(context, recoverRequestSchema)
    try {
      const { dataEncryptionKey, newRecoveryCode } = await vault.recoverWithRecoveryCode(
        recoverRequest.recoveryCode,
        recoverRequest.newPassphrase,
      )
      unlockRateLimiter.recordSuccess(clientIpAddress(context))
      sessions.destroyAll()
      audit(context, 'recovered_with_recovery_code')
      startSession(context, dataEncryptionKey)
      return context.json({ recoveryCode: newRecoveryCode })
    } catch (error) {
      if (error instanceof VaultError && error.code === 'wrong_credentials') {
        unlockRateLimiter.recordFailure(clientIpAddress(context))
        audit(context, 'recovery_failed')
      }
      throw error
    }
  })

  app.post('/api/logout', (context) => {
    if (sessions.touch(getCookie(context, sessionCookieName))) audit(context, 'locked')
    endSession(context)
    return context.json({ ok: true })
  })

  // ---------- everything below requires an unlocked session ----------

  app.use('/api/*', async (context, next) => {
    const session = sessions.touch(getCookie(context, sessionCookieName))
    if (!session) return context.json({ error: 'locked', message: 'The journal is locked.' }, 401)
    context.set('session', session)
    await next()
  })

  const keyOf = (context: Context<AppEnvironment>) => context.get('session').dataEncryptionKey

  // Tags
  app.get('/api/tags', (context) => {
    const allTags = tagRepository.listAll(keyOf(context))
    const usageCountByTagId = countTagUsage(entryRepository.listAll(keyOf(context)))
    return context.json(allTags.map((tag) => ({ ...tag, usageCount: usageCountByTagId.get(tag.id) ?? 0 })))
  })

  app.post('/api/tags', async (context) => {
    const tagInput = await readJsonBody(context, tagInputSchema)
    return context.json(tagRepository.create(keyOf(context), tagInput, nowIso()), 201)
  })

  app.put('/api/tags/:tagId', async (context) => {
    const tagInput = await readJsonBody(context, tagInputSchema)
    return context.json(tagRepository.replace(keyOf(context), context.req.param('tagId'), tagInput))
  })

  app.delete('/api/tags/:tagId', (context) => {
    const tagId = context.req.param('tagId')
    const usageCount = countTagUsage(entryRepository.listAll(keyOf(context))).get(tagId) ?? 0
    if (usageCount > 0) {
      throw new RecordConflictError(`This tag is on ${usageCount} ${usageCount === 1 ? 'entry' : 'entries'}. Archive it instead to keep those records intact.`)
    }
    tagRepository.delete(tagId)
    return context.json({ ok: true })
  })

  // Entries
  app.get('/api/entries', (context) => context.json(entryRepository.listAll(keyOf(context))))

  app.get('/api/entries/:entryId', (context) => context.json(entryRepository.get(keyOf(context), context.req.param('entryId'))))

  app.post('/api/entries', async (context) => {
    const entryInput = await readJsonBody(context, entryInputSchema)
    assertEntryTagReferencesAreValid(entryInput, tagRepository.listAll(keyOf(context)))
    return context.json(entryRepository.create(keyOf(context), entryInput, nowIso()), 201)
  })

  app.put('/api/entries/:entryId', async (context) => {
    const entryInput = await readJsonBody(context, entryInputSchema)
    assertEntryTagReferencesAreValid(entryInput, tagRepository.listAll(keyOf(context)))
    return context.json(entryRepository.replace(keyOf(context), context.req.param('entryId'), entryInput, nowIso()))
  })

  app.delete('/api/entries/:entryId', (context) => {
    entryRepository.delete(context.req.param('entryId'))
    return context.json({ ok: true })
  })

  // Export (plaintext leaves the server here, on purpose and logged)
  app.get('/api/export', (context) => {
    const exportFormat = context.req.query('format') === 'csv' ? 'csv' : 'json'
    const allTags = tagRepository.listAll(keyOf(context))
    const allEntries = entryRepository.listAll(keyOf(context))
    const dateStamp = nowIso().slice(0, 10)
    audit(context, `exported_${exportFormat}`)
    if (exportFormat === 'csv') {
      context.header('Content-Type', 'text/csv; charset=utf-8')
      context.header('Content-Disposition', `attachment; filename="reframe-${dateStamp}.csv"`)
      return context.body(buildEntriesCsv(allEntries, allTags))
    }
    context.header('Content-Disposition', `attachment; filename="reframe-${dateStamp}.json"`)
    return context.json({ format: 'reframe-export', version: 1, exportedAt: nowIso(), tags: allTags, entries: allEntries })
  })

  // Security settings
  app.get('/api/audit', (context) => context.json(auditLog.listRecent(100)))

  // Reports and the Guava CSV are assembled in the browser; this only records that one was made.
  app.post('/api/audit/client-export', async (context) => {
    const { kind } = await readJsonBody(context, clientExportAuditSchema)
    audit(context, kind === 'report' ? 'report_prepared' : 'exported_guava_csv')
    return context.json({ ok: true })
  })

  app.post('/api/passphrase', async (context) => {
    const rateLimitedResponse = rejectIfRateLimited(context)
    if (rateLimitedResponse) return rateLimitedResponse
    const changeRequest = await readJsonBody(context, changePassphraseRequestSchema)
    try {
      await vault.changePassphrase(changeRequest.currentPassphrase, changeRequest.newPassphrase)
    } catch (error) {
      if (error instanceof VaultError && error.code === 'wrong_credentials') unlockRateLimiter.recordFailure(clientIpAddress(context))
      throw error
    }
    // Sign out every other device; keep this one.
    const currentKeyCopy = Buffer.from(keyOf(context))
    sessions.destroyAll()
    audit(context, 'passphrase_changed')
    startSession(context, currentKeyCopy)
    return context.json({ ok: true })
  })

  app.post('/api/recovery-code', async (context) => {
    const rateLimitedResponse = rejectIfRateLimited(context)
    if (rateLimitedResponse) return rateLimitedResponse
    const confirmation = await readJsonBody(context, passphraseConfirmationSchema)
    try {
      await vault.verifyPassphrase(confirmation.passphrase)
    } catch (error) {
      if (error instanceof VaultError && error.code === 'wrong_credentials') unlockRateLimiter.recordFailure(clientIpAddress(context))
      throw error
    }
    const recoveryCode = await vault.regenerateRecoveryCode(keyOf(context))
    audit(context, 'recovery_code_replaced')
    return context.json({ recoveryCode })
  })

  app.post('/api/totp/begin', (context) => {
    const session = context.get('session')
    const { secret, secretBase32 } = vault.createPendingTotpSecret()
    session.pendingTotpSecret?.fill(0)
    session.pendingTotpSecret = secret
    return context.json({ secretBase32, otpauthUri: buildOtpauthUri(secretBase32, 'journal', 'Reframe') })
  })

  app.post('/api/totp/confirm', async (context) => {
    const session = context.get('session')
    const { code } = await readJsonBody(context, totpConfirmRequestSchema)
    if (!session.pendingTotpSecret) throw new VaultError('totp_not_pending', 'Start setup again to get a new secret.')
    vault.confirmTotpEnrollment(session.dataEncryptionKey, session.pendingTotpSecret, code)
    session.pendingTotpSecret.fill(0)
    session.pendingTotpSecret = null
    audit(context, 'authenticator_enabled')
    return context.json({ ok: true })
  })

  app.post('/api/totp/disable', async (context) => {
    const rateLimitedResponse = rejectIfRateLimited(context)
    if (rateLimitedResponse) return rateLimitedResponse
    const confirmation = await readJsonBody(context, passphraseConfirmationSchema)
    try {
      await vault.verifyPassphrase(confirmation.passphrase)
    } catch (error) {
      if (error instanceof VaultError && error.code === 'wrong_credentials') unlockRateLimiter.recordFailure(clientIpAddress(context))
      throw error
    }
    vault.disableTotp()
    audit(context, 'authenticator_disabled')
    return context.json({ ok: true })
  })

  app.all('/api/*', (context) => context.json({ error: 'not_found', message: 'No such endpoint.' }, 404))

  // ---------- static client ----------

  app.get('*', (context) => {
    const requestedPath = context.req.path
    const asset = staticAssets.get(requestedPath) ?? staticAssets.get('/index.html')
    if (!asset) return context.text('Client not built. Run npm run build.', 503)
    context.header('Content-Type', asset.contentType)
    context.header(
      'Cache-Control',
      asset.isFingerprinted && staticAssets.has(requestedPath) ? 'public, max-age=31536000, immutable' : 'no-cache',
    )
    return context.body(new Uint8Array(asset.body))
  })

  // ---------- errors ----------

  app.onError((error, context) => {
    if (error instanceof VaultError) {
      const statusByCode = {
        vault_exists: 409,
        vault_missing: 409,
        wrong_credentials: 401,
        totp_required: 401,
        weak_passphrase: 400,
        totp_not_pending: 409,
        totp_invalid: 400,
      } as const
      return context.json({ error: error.code, message: error.message }, statusByCode[error.code])
    }
    if (error instanceof z.ZodError) {
      return context.json({ error: 'invalid_request', message: 'Some fields are missing or invalid.', issues: error.issues }, 400)
    }
    if (error instanceof RecordNotFoundError) return context.json({ error: 'not_found', message: error.message }, 404)
    if (error instanceof RecordConflictError) return context.json({ error: 'conflict', message: error.message }, 409)
    if (error instanceof RecordValidationError) return context.json({ error: 'invalid_request', message: error.message }, 400)
    // Never echo internal errors: they could include decrypted content.
    // Log the error type and stack frames only, never the message.
    const stackFramesOnly = error instanceof Error ? (error.stack ?? '').split('\n').slice(1, 8).join('\n') : ''
    console.error(`Unhandled ${error instanceof Error ? error.name : 'error'}\n${stackFramesOnly}`)
    return context.json({ error: 'server_error', message: 'Something went wrong on the server.' }, 500)
  })

  return { app, sessions, vault }
}

function formatWait(totalSeconds: number): string {
  if (totalSeconds < 90) return `${totalSeconds} seconds`
  return `${Math.ceil(totalSeconds / 60)} minutes`
}

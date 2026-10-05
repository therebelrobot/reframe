import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestHarness, TEST_PASSPHRASE, TEST_SETUP_TOKEN } from './testHelpers'
import { generateTotpCode, computeTimeStepCounter } from '../server/crypto/totp'
import { decodeBase32 } from '../server/crypto/base32'
import type { Entry, EntryInput, Tag } from '../shared/model'

async function setUpVault() {
  const harness = createTestHarness()
  const browser = harness.createBrowser()
  const setupResponse = await browser.request('POST', '/api/setup', { setupToken: TEST_SETUP_TOKEN, passphrase: TEST_PASSPHRASE })
  assert.equal(setupResponse.status, 200)
  const { recoveryCode } = (await setupResponse.json()) as { recoveryCode: string }
  return { harness, browser, recoveryCode }
}

async function listTags(browser: ReturnType<ReturnType<typeof createTestHarness>['createBrowser']>) {
  return (await (await browser.request('GET', '/api/tags')).json()) as (Tag & { usageCount: number })[]
}

function buildEntryInput(tags: Tag[], overrides: Partial<EntryInput> = {}): EntryInput {
  const firstOfKind = (kind: Tag['kind']) => tags.find((tag) => tag.kind === kind)!.id
  return {
    occurredAt: '2026-10-04T21:15:00.000Z',
    status: 'complete',
    situation: 'UNIQUE_SITUATION_MARKER standup ran long',
    contextTagIds: [firstOfKind('context')],
    emotions: [{ tagId: firstOfKind('emotion'), intensityBefore: 80, intensityAfter: 40 }],
    sensationTagIds: [firstOfKind('sensation')],
    bodyNotes: '',
    thoughts: 'They think I am behind',
    patternTagIds: [firstOfKind('pattern')],
    alternativeThought: 'Nobody said that',
    response: 'Breathed, then asked',
    techniqueTagIds: [firstOfKind('technique')],
    ...overrides,
  }
}

test('setup requires the setup token and can only happen once', async () => {
  const harness = createTestHarness()
  const browser = harness.createBrowser()
  const wrongToken = await browser.request('POST', '/api/setup', { setupToken: 'nope', passphrase: TEST_PASSPHRASE })
  assert.equal(wrongToken.status, 401)
  const weak = await browser.request('POST', '/api/setup', { setupToken: TEST_SETUP_TOKEN, passphrase: 'short' })
  assert.equal(weak.status, 400)
  const ok = await browser.request('POST', '/api/setup', { setupToken: TEST_SETUP_TOKEN, passphrase: TEST_PASSPHRASE })
  assert.equal(ok.status, 200)
  const again = await browser.request('POST', '/api/setup', { setupToken: TEST_SETUP_TOKEN, passphrase: TEST_PASSPHRASE })
  assert.equal(again.status, 409)
})

test('session cookie is __Host-, HttpOnly, Secure, SameSite=Strict', async () => {
  const harness = createTestHarness()
  const response = await harness.app.request('/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-reframe-request': '1', host: 'journal.example.com' },
    body: JSON.stringify({ setupToken: TEST_SETUP_TOKEN, passphrase: TEST_PASSPHRASE }),
  })
  const setCookie = response.headers.get('set-cookie') ?? ''
  assert.match(setCookie, /^__Host-reframe_session=/)
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /Secure/)
  assert.match(setCookie, /SameSite=Strict/)
})

test('entries are stored encrypted and round-trip through the API', async () => {
  const { harness, browser } = await setUpVault()
  const tags = await listTags(browser)
  assert.ok(tags.length > 30, 'starter tags are seeded')
  const created = await browser.request('POST', '/api/entries', buildEntryInput(tags))
  assert.equal(created.status, 201)
  const createdEntry = (await created.json()) as Entry
  const listed = (await (await browser.request('GET', '/api/entries')).json()) as Entry[]
  assert.equal(listed.length, 1)
  assert.equal(listed[0]!.situation, createdEntry.situation)

  const rawRows = harness.database.prepare('SELECT payload FROM entries').all() as { payload: Uint8Array }[]
  const rawText = Buffer.concat(rawRows.map((row) => Buffer.from(row.payload))).toString('latin1')
  assert.ok(!rawText.includes('UNIQUE_SITUATION_MARKER'), 'plaintext must not appear in the database')
  const rawTagRows = harness.database.prepare('SELECT payload FROM tags').all() as { payload: Uint8Array }[]
  assert.ok(!Buffer.concat(rawTagRows.map((row) => Buffer.from(row.payload))).toString('latin1').includes('Anxious'))

  const updated = await browser.request('PUT', `/api/entries/${createdEntry.id}`, buildEntryInput(tags, { status: 'draft' }))
  assert.equal(((await updated.json()) as Entry).status, 'draft')
  const tagsAfter = await listTags(browser)
  assert.equal(tagsAfter.find((tag) => tag.id === createdEntry.contextTagIds[0])!.usageCount, 1)

  assert.equal((await browser.request('DELETE', `/api/entries/${createdEntry.id}`)).status, 200)
  assert.equal((await browser.request('GET', `/api/entries/${createdEntry.id}`)).status, 404)
})

test('entries reject tags of the wrong kind or unknown ids', async () => {
  const { browser } = await setUpVault()
  const tags = await listTags(browser)
  const contextTagId = tags.find((tag) => tag.kind === 'context')!.id
  const wrongKind = await browser.request(
    'POST',
    '/api/entries',
    buildEntryInput(tags, { emotions: [{ tagId: contextTagId, intensityBefore: 10, intensityAfter: null }] }),
  )
  assert.equal(wrongKind.status, 400)
  const outOfRange = await browser.request(
    'POST',
    '/api/entries',
    buildEntryInput(tags, { emotions: [{ tagId: tags.find((tag) => tag.kind === 'emotion')!.id, intensityBefore: 101, intensityAfter: null }] }),
  )
  assert.equal(outOfRange.status, 400)
})

test('tags: duplicate names conflict, in-use tags cannot be deleted', async () => {
  const { browser } = await setUpVault()
  const duplicate = await browser.request('POST', '/api/tags', { kind: 'context', name: ' work ', archived: false })
  assert.equal(duplicate.status, 409)
  const created = (await (await browser.request('POST', '/api/tags', { kind: 'context', name: 'Commute', archived: false })).json()) as Tag
  const tags = await listTags(browser)
  await browser.request('POST', '/api/entries', buildEntryInput(tags, { contextTagIds: [created.id] }))
  assert.equal((await browser.request('DELETE', `/api/tags/${created.id}`)).status, 409)
  const archived = await browser.request('PUT', `/api/tags/${created.id}`, { kind: 'context', name: 'Commute', archived: true })
  assert.equal(((await archived.json()) as Tag).archived, true)
})

test('locked requests are refused; lock, wrong passphrase, unlock', async () => {
  const { browser } = await setUpVault()
  assert.equal((await browser.request('POST', '/api/logout')).status, 200)
  assert.equal((await browser.request('GET', '/api/entries')).status, 401)
  const wrong = await browser.request('POST', '/api/login', { passphrase: 'not the passphrase at all' })
  assert.equal(wrong.status, 401)
  const right = await browser.request('POST', '/api/login', { passphrase: TEST_PASSPHRASE })
  assert.equal(right.status, 200)
  assert.equal((await browser.request('GET', '/api/entries')).status, 200)
})

test('unlock is throttled after repeated failures, per IP', async () => {
  const { harness } = await setUpVault()
  const attacker = harness.createBrowser('198.51.100.7')
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await attacker.request('POST', '/api/login', { passphrase: `guess number ${attempt}` })).status, 401)
  }
  const throttled = await attacker.request('POST', '/api/login', { passphrase: TEST_PASSPHRASE })
  assert.equal(throttled.status, 429)
  assert.ok(Number(throttled.headers.get('retry-after')) > 0)
  // A different IP is not affected.
  const owner = harness.createBrowser('203.0.113.99')
  assert.equal((await owner.request('POST', '/api/login', { passphrase: TEST_PASSPHRASE })).status, 200)
  harness.advanceTime(31_000)
  assert.equal((await attacker.request('POST', '/api/login', { passphrase: TEST_PASSPHRASE })).status, 200)
})

test('state-changing requests need the custom header and a same-origin Origin', async () => {
  const { harness, browser } = await setUpVault()
  const noHeader = await harness.app.request('/api/logout', { method: 'POST', headers: { host: 'journal.example.com' } })
  assert.equal(noHeader.status, 403)
  const crossOrigin = await browser.request('POST', '/api/logout', undefined, { origin: 'https://evil.example.net' })
  assert.equal(crossOrigin.status, 403)
  const sameOrigin = await browser.request('POST', '/api/logout', undefined, { origin: 'https://journal.example.com' })
  assert.equal(sameOrigin.status, 200)
})

test('sessions expire after the idle window', async () => {
  const { harness, browser } = await setUpVault()
  harness.advanceTime(29 * 60_000)
  assert.equal((await browser.request('GET', '/api/entries')).status, 200)
  harness.advanceTime(31 * 60_000)
  assert.equal((await browser.request('GET', '/api/entries')).status, 401)
})

test('recovery code resets the passphrase, retires itself and keeps data readable', async () => {
  const { harness, browser, recoveryCode } = await setUpVault()
  const tags = await listTags(browser)
  await browser.request('POST', '/api/entries', buildEntryInput(tags))
  await browser.request('POST', '/api/logout')
  const other = harness.createBrowser('203.0.113.50')
  const recovered = await other.request('POST', '/api/recover', {
    recoveryCode: recoveryCode.toLowerCase(),
    newPassphrase: 'a brand new long passphrase',
  })
  assert.equal(recovered.status, 200)
  const { recoveryCode: newRecoveryCode } = (await recovered.json()) as { recoveryCode: string }
  assert.notEqual(newRecoveryCode, recoveryCode)
  assert.equal(((await (await other.request('GET', '/api/entries')).json()) as Entry[]).length, 1)
  await other.request('POST', '/api/logout')
  assert.equal((await other.request('POST', '/api/login', { passphrase: TEST_PASSPHRASE })).status, 401)
  assert.equal((await other.request('POST', '/api/login', { passphrase: 'a brand new long passphrase' })).status, 200)
  const reuse = await other.request('POST', '/api/recover', { recoveryCode, newPassphrase: 'another long passphrase' })
  assert.equal(reuse.status, 401)
})

test('changing the passphrase signs out other devices', async () => {
  const { harness, browser } = await setUpVault()
  const phone = harness.createBrowser('203.0.113.60')
  assert.equal((await phone.request('POST', '/api/login', { passphrase: TEST_PASSPHRASE })).status, 200)
  const changed = await browser.request('POST', '/api/passphrase', {
    currentPassphrase: TEST_PASSPHRASE,
    newPassphrase: 'the second long passphrase',
  })
  assert.equal(changed.status, 200)
  assert.equal((await browser.request('GET', '/api/entries')).status, 200)
  assert.equal((await phone.request('GET', '/api/entries')).status, 401)
})

test('authenticator enrollment then requires a code at unlock', async () => {
  const { harness, browser } = await setUpVault()
  const begin = (await (await browser.request('POST', '/api/totp/begin')).json()) as { secretBase32: string; otpauthUri: string }
  assert.match(begin.otpauthUri, /^otpauth:\/\/totp\//)
  const secret = decodeBase32(begin.secretBase32)
  const confirm = await browser.request('POST', '/api/totp/confirm', {
    code: generateTotpCode(secret, computeTimeStepCounter(harness.now())),
  })
  assert.equal(confirm.status, 200)
  await browser.request('POST', '/api/logout')
  const status = (await (await browser.request('GET', '/api/status')).json()) as { totpEnabled: boolean }
  assert.equal(status.totpEnabled, true)
  const withoutCode = await browser.request('POST', '/api/login', { passphrase: TEST_PASSPHRASE })
  assert.equal(((await withoutCode.json()) as { error: string }).error, 'totp_required')
  // Same answer for a wrong passphrase: no oracle confirming the passphrase without the second factor.
  const wrongWithoutCode = await browser.request('POST', '/api/login', { passphrase: 'definitely not it at all' })
  assert.equal(((await wrongWithoutCode.json()) as { error: string }).error, 'totp_required')
  harness.advanceTime(30_000)
  const withCode = await browser.request('POST', '/api/login', {
    passphrase: TEST_PASSPHRASE,
    totpCode: generateTotpCode(secret, computeTimeStepCounter(harness.now())),
  })
  assert.equal(withCode.status, 200)
})

test('CSV export neutralizes spreadsheet formulas', async () => {
  const { browser } = await setUpVault()
  const tags = await listTags(browser)
  await browser.request('POST', '/api/entries', buildEntryInput(tags, { situation: '=HYPERLINK("http://x")' }))
  const csvText = await (await browser.request('GET', '/api/export?format=csv')).text()
  assert.ok(csvText.includes(`"'=HYPERLINK(""http://x"")"`))
  const audit = (await (await browser.request('GET', '/api/audit')).json()) as { event: string }[]
  assert.ok(audit.some((auditEvent) => auditEvent.event === 'exported_csv'))
})

test('security headers are present on every response', async () => {
  const { browser } = await setUpVault()
  const response = await browser.request('GET', '/api/entries')
  assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self'/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.match(response.headers.get('strict-transport-security') ?? '', /max-age/)
})

test('browser-made exports are recorded in the access log, and only when unlocked', async () => {
  const { browser } = await setUpVault()
  assert.equal((await browser.request('POST', '/api/audit/client-export', { kind: 'report' })).status, 200)
  assert.equal((await browser.request('POST', '/api/audit/client-export', { kind: 'guava_csv' })).status, 200)
  assert.equal((await browser.request('POST', '/api/audit/client-export', { kind: 'anything else' })).status, 400)
  const audit = (await (await browser.request('GET', '/api/audit')).json()) as { event: string }[]
  assert.ok(audit.some((auditEvent) => auditEvent.event === 'report_prepared'))
  assert.ok(audit.some((auditEvent) => auditEvent.event === 'exported_guava_csv'))
  await browser.request('POST', '/api/logout')
  assert.equal((await browser.request('POST', '/api/audit/client-export', { kind: 'report' })).status, 401)
})

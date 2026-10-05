import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DecryptionFailedError,
  decryptJson,
  deriveKeyEncryptionKey,
  encryptJson,
  generateDataEncryptionKey,
  recordAdditionalAuthenticatedData,
} from '../server/crypto/envelope'
import { decodeBase32, encodeBase32 } from '../server/crypto/base32'
import { generateTotpCode, verifyTotpCode } from '../server/crypto/totp'

test('record encryption round-trips', () => {
  const dataEncryptionKey = generateDataEncryptionKey()
  const aad = recordAdditionalAuthenticatedData('entries', 'abc')
  const envelope = encryptJson(dataEncryptionKey, { situation: 'meeting ran long' }, aad)
  assert.deepEqual(decryptJson(dataEncryptionKey, envelope, aad), { situation: 'meeting ran long' })
  assert.ok(!envelope.toString('utf8').includes('meeting'))
})

test('ciphertext is bound to its row: moving it to another id fails', () => {
  const dataEncryptionKey = generateDataEncryptionKey()
  const envelope = encryptJson(dataEncryptionKey, { a: 1 }, recordAdditionalAuthenticatedData('entries', 'row-1'))
  assert.throws(
    () => decryptJson(dataEncryptionKey, envelope, recordAdditionalAuthenticatedData('entries', 'row-2')),
    DecryptionFailedError,
  )
})

test('wrong key and tampering both fail authentication', () => {
  const dataEncryptionKey = generateDataEncryptionKey()
  const aad = recordAdditionalAuthenticatedData('tags', 'x')
  const envelope = encryptJson(dataEncryptionKey, { name: 'Work' }, aad)
  assert.throws(() => decryptJson(generateDataEncryptionKey(), envelope, aad), DecryptionFailedError)
  const tamperedEnvelope = Buffer.from(envelope)
  tamperedEnvelope[tamperedEnvelope.length - 1]! ^= 1
  assert.throws(() => decryptJson(dataEncryptionKey, tamperedEnvelope, aad), DecryptionFailedError)
})

test('scrypt normalizes unicode so composed and decomposed forms match', async () => {
  const salt = Buffer.alloc(16, 7)
  const parameters = { costFactorN: 2 ** 10, blockSizeR: 8, parallelizationP: 1 }
  const composed = await deriveKeyEncryptionKey('café passphrase', salt, parameters)
  const decomposed = await deriveKeyEncryptionKey('café passphrase', salt, parameters)
  assert.deepEqual(composed, decomposed)
})

test('base32 round-trips', () => {
  const originalBytes = Buffer.from('12345678901234567890')
  assert.equal(encodeBase32(originalBytes), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
  assert.deepEqual(decodeBase32('gezd-gnbv gy3tqojqgezdgnbvgy3tqojq'), originalBytes)
})

test('TOTP matches the RFC 6238 SHA-1 test vector', () => {
  const rfcSecret = Buffer.from('12345678901234567890')
  // RFC 6238 Appendix B: T=59s -> 94287082 (8 digits); 6-digit truncation is the last 6.
  assert.equal(generateTotpCode(rfcSecret, Math.floor(59 / 30)), '287082')
  assert.equal(generateTotpCode(rfcSecret, Math.floor(1111111109 / 30)), '081804')
})

test('TOTP accepts one step of drift and refuses replays', () => {
  const secret = Buffer.from('12345678901234567890')
  const nowMilliseconds = 1_700_000_000_000
  const currentCounter = Math.floor(nowMilliseconds / 30_000)
  const previousStepCode = generateTotpCode(secret, currentCounter - 1)
  assert.equal(verifyTotpCode(secret, previousStepCode, nowMilliseconds, null), currentCounter - 1)
  assert.equal(verifyTotpCode(secret, previousStepCode, nowMilliseconds, currentCounter - 1), null)
  assert.equal(verifyTotpCode(secret, generateTotpCode(secret, currentCounter - 3), nowMilliseconds, null), null)
  assert.equal(verifyTotpCode(secret, 'abcdef', nowMilliseconds, null), null)
})

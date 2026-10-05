import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'

/**
 * Envelope encryption.
 *
 * - A random 256-bit data encryption key (DEK) encrypts every record.
 * - The DEK is stored only in wrapped form: AES-256-GCM encrypted under a key
 *   encryption key (KEK) derived from the passphrase with scrypt. A second copy
 *   is wrapped under a KEK derived from the one-time recovery code.
 * - The plaintext DEK exists only in server memory while a session is unlocked.
 *   A stolen database file or backup is ciphertext without the passphrase.
 *
 * Every ciphertext carries additional authenticated data (AAD) naming what it
 * is (for records: table + row id) so ciphertext cannot be swapped between rows
 * or reused as a different kind of secret without failing authentication.
 */

export const DATA_ENCRYPTION_KEY_BYTES = 32
const GCM_IV_BYTES = 12
const GCM_AUTH_TAG_BYTES = 16
const CIPHERTEXT_FORMAT_VERSION = 1

export interface ScryptParameters {
  costFactorN: number
  blockSizeR: number
  parallelizationP: number
}

/** ~128 MiB working memory; roughly 0.5-1.5 s on a Raspberry Pi 4/5. */
export const DEFAULT_SCRYPT_PARAMETERS: ScryptParameters = {
  costFactorN: 2 ** 17,
  blockSizeR: 8,
  parallelizationP: 1,
}

export function generateRandomBytes(byteCount: number): Buffer {
  return randomBytes(byteCount)
}

export function generateDataEncryptionKey(): Buffer {
  return randomBytes(DATA_ENCRYPTION_KEY_BYTES)
}

export async function deriveKeyEncryptionKey(
  secretText: string,
  salt: Buffer,
  scryptParameters: ScryptParameters,
): Promise<Buffer> {
  // NFKC so the same passphrase typed on different keyboards/OSes derives the same key.
  const normalizedSecret = secretText.normalize('NFKC')
  const workingMemoryBytes = 128 * scryptParameters.costFactorN * scryptParameters.blockSizeR
  return new Promise((resolve, reject) => {
    scryptCallback(
      normalizedSecret,
      salt,
      DATA_ENCRYPTION_KEY_BYTES,
      {
        N: scryptParameters.costFactorN,
        r: scryptParameters.blockSizeR,
        p: scryptParameters.parallelizationP,
        maxmem: workingMemoryBytes * 2,
      },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    )
  })
}

/** Layout: [version:1][iv:12][authTag:16][ciphertext:n] */
export function encryptBytes(key: Buffer, plaintext: Buffer, additionalAuthenticatedData: string): Buffer {
  const initializationVector = randomBytes(GCM_IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, initializationVector, { authTagLength: GCM_AUTH_TAG_BYTES })
  cipher.setAAD(Buffer.from(additionalAuthenticatedData, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([CIPHERTEXT_FORMAT_VERSION]), initializationVector, authTag, ciphertext])
}

export class DecryptionFailedError extends Error {
  constructor() {
    super('Decryption failed: wrong key or tampered data')
    this.name = 'DecryptionFailedError'
  }
}

export function decryptBytes(key: Buffer, envelope: Uint8Array, additionalAuthenticatedData: string): Buffer {
  const envelopeBuffer = Buffer.from(envelope)
  if (envelopeBuffer.length < 1 + GCM_IV_BYTES + GCM_AUTH_TAG_BYTES || envelopeBuffer[0] !== CIPHERTEXT_FORMAT_VERSION) {
    throw new DecryptionFailedError()
  }
  const initializationVector = envelopeBuffer.subarray(1, 1 + GCM_IV_BYTES)
  const authTag = envelopeBuffer.subarray(1 + GCM_IV_BYTES, 1 + GCM_IV_BYTES + GCM_AUTH_TAG_BYTES)
  const ciphertext = envelopeBuffer.subarray(1 + GCM_IV_BYTES + GCM_AUTH_TAG_BYTES)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, initializationVector, { authTagLength: GCM_AUTH_TAG_BYTES })
    decipher.setAAD(Buffer.from(additionalAuthenticatedData, 'utf8'))
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new DecryptionFailedError()
  }
}

export function encryptJson(key: Buffer, value: unknown, additionalAuthenticatedData: string): Buffer {
  return encryptBytes(key, Buffer.from(JSON.stringify(value), 'utf8'), additionalAuthenticatedData)
}

export function decryptJson<T>(key: Buffer, envelope: Uint8Array, additionalAuthenticatedData: string): T {
  return JSON.parse(decryptBytes(key, envelope, additionalAuthenticatedData).toString('utf8')) as T
}

export function constantTimeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right)
}

export function recordAdditionalAuthenticatedData(tableName: string, rowId: string): string {
  return `reframe:record:${tableName}:${rowId}`
}

export const WRAPPED_KEY_AAD_PASSPHRASE = 'reframe:dek-wrap:passphrase'
export const WRAPPED_KEY_AAD_RECOVERY = 'reframe:dek-wrap:recovery-code'
export const TOTP_SECRET_AAD = 'reframe:totp-secret'

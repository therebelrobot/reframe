import { createHmac } from 'node:crypto'
import { constantTimeEqual } from './envelope'

// RFC 6238 TOTP: HMAC-SHA1, 30-second steps, 6 digits — what every authenticator app speaks.
const TIME_STEP_SECONDS = 30
const CODE_DIGITS = 6
/** Accept the previous and next step too, to absorb phone clock drift. */
const ALLOWED_STEP_DRIFT = 1

export function computeTimeStepCounter(atMilliseconds: number): number {
  return Math.floor(atMilliseconds / 1000 / TIME_STEP_SECONDS)
}

export function generateTotpCode(secret: Buffer, timeStepCounter: number): string {
  const counterBytes = Buffer.alloc(8)
  counterBytes.writeBigUInt64BE(BigInt(timeStepCounter))
  const hmacDigest = createHmac('sha1', secret).update(counterBytes).digest()
  const dynamicOffset = hmacDigest[hmacDigest.length - 1]! & 0x0f
  const truncatedValue =
    ((hmacDigest[dynamicOffset]! & 0x7f) << 24) |
    (hmacDigest[dynamicOffset + 1]! << 16) |
    (hmacDigest[dynamicOffset + 2]! << 8) |
    hmacDigest[dynamicOffset + 3]!
  return String(truncatedValue % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, '0')
}

/**
 * Returns the matched time-step counter, or null. Codes at or below
 * `lastAcceptedCounter` are rejected so a shoulder-surfed code can't be replayed.
 */
export function verifyTotpCode(
  secret: Buffer,
  submittedCode: string,
  atMilliseconds: number,
  lastAcceptedCounter: number | null,
): number | null {
  const normalizedCode = submittedCode.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(normalizedCode)) return null
  const currentCounter = computeTimeStepCounter(atMilliseconds)
  for (let drift = -ALLOWED_STEP_DRIFT; drift <= ALLOWED_STEP_DRIFT; drift += 1) {
    const candidateCounter = currentCounter + drift
    if (lastAcceptedCounter !== null && candidateCounter <= lastAcceptedCounter) continue
    const expectedCode = generateTotpCode(secret, candidateCounter)
    if (constantTimeEqual(Buffer.from(expectedCode), Buffer.from(normalizedCode))) {
      return candidateCounter
    }
  }
  return null
}

export function buildOtpauthUri(secretBase32: string, accountLabel: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`)
  const parameters = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(CODE_DIGITS),
    period: String(TIME_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${parameters.toString()}`
}

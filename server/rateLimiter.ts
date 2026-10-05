/**
 * Failed-unlock throttling.
 *
 * Per client IP: the first FREE_ATTEMPTS failures are free, then each further
 * failure doubles a lockout (30 s, 60 s, 2 min ... capped at 1 h).
 * Globally: if more than GLOBAL_FAILURE_LIMIT failures arrive inside the window
 * (many IPs guessing at once), every IP is locked out for the window. That can
 * lock you out too during an attack, which is the right trade for a vault.
 *
 * scrypt already makes each guess cost ~1 s of CPU; this stops the rest.
 */
const FREE_ATTEMPTS = 5
const BASE_LOCKOUT_MILLISECONDS = 30_000
const MAX_LOCKOUT_MILLISECONDS = 60 * 60_000
const GLOBAL_WINDOW_MILLISECONDS = 15 * 60_000
const GLOBAL_FAILURE_LIMIT = 30

interface ClientFailureRecord {
  consecutiveFailures: number
  lockedUntilMilliseconds: number
}

export class UnlockRateLimiter {
  private readonly failuresByClient = new Map<string, ClientFailureRecord>()
  private globalFailureTimestamps: number[] = []

  constructor(private readonly currentTimeMilliseconds: () => number = Date.now) {}

  /** Milliseconds the client must still wait, or 0 if it may try now. */
  retryAfterMilliseconds(clientKey: string): number {
    const nowMilliseconds = this.currentTimeMilliseconds()
    this.globalFailureTimestamps = this.globalFailureTimestamps.filter(
      (failureTimestamp) => nowMilliseconds - failureTimestamp < GLOBAL_WINDOW_MILLISECONDS,
    )
    let waitMilliseconds = 0
    if (this.globalFailureTimestamps.length >= GLOBAL_FAILURE_LIMIT) {
      const oldestFailure = this.globalFailureTimestamps[0]!
      waitMilliseconds = oldestFailure + GLOBAL_WINDOW_MILLISECONDS - nowMilliseconds
    }
    const clientRecord = this.failuresByClient.get(clientKey)
    if (clientRecord && clientRecord.lockedUntilMilliseconds > nowMilliseconds) {
      waitMilliseconds = Math.max(waitMilliseconds, clientRecord.lockedUntilMilliseconds - nowMilliseconds)
    }
    return Math.max(0, waitMilliseconds)
  }

  recordFailure(clientKey: string): void {
    const nowMilliseconds = this.currentTimeMilliseconds()
    this.globalFailureTimestamps.push(nowMilliseconds)
    const clientRecord = this.failuresByClient.get(clientKey) ?? { consecutiveFailures: 0, lockedUntilMilliseconds: 0 }
    clientRecord.consecutiveFailures += 1
    if (clientRecord.consecutiveFailures >= FREE_ATTEMPTS) {
      const lockoutMilliseconds = Math.min(
        BASE_LOCKOUT_MILLISECONDS * 2 ** (clientRecord.consecutiveFailures - FREE_ATTEMPTS),
        MAX_LOCKOUT_MILLISECONDS,
      )
      clientRecord.lockedUntilMilliseconds = nowMilliseconds + lockoutMilliseconds
    }
    this.failuresByClient.set(clientKey, clientRecord)
  }

  recordSuccess(clientKey: string): void {
    this.failuresByClient.delete(clientKey)
  }
}

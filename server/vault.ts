import type { Database } from './database'
import { decodeBase32, encodeBase32 } from './crypto/base32'
import {
  DecryptionFailedError,
  TOTP_SECRET_AAD,
  WRAPPED_KEY_AAD_PASSPHRASE,
  WRAPPED_KEY_AAD_RECOVERY,
  decryptBytes,
  deriveKeyEncryptionKey,
  encryptBytes,
  generateDataEncryptionKey,
  generateRandomBytes,
  type ScryptParameters,
} from './crypto/envelope'
import { verifyTotpCode } from './crypto/totp'

const SALT_BYTES = 16
const RECOVERY_CODE_BYTES = 20 // 160 bits, shown as 32 base32 characters
export const MINIMUM_PASSPHRASE_LENGTH = 12

interface VaultRow {
  scrypt_cost_factor_n: number
  scrypt_block_size_r: number
  scrypt_parallelization_p: number
  passphrase_salt: Uint8Array
  passphrase_wrapped_key: Uint8Array
  recovery_salt: Uint8Array
  recovery_wrapped_key: Uint8Array
  totp_secret_encrypted: Uint8Array | null
  totp_last_accepted_counter: number | null
}

export class VaultError extends Error {
  constructor(
    public readonly code:
      | 'vault_exists'
      | 'vault_missing'
      | 'wrong_credentials'
      | 'totp_required'
      | 'weak_passphrase'
      | 'totp_not_pending'
      | 'totp_invalid',
    message: string,
  ) {
    super(message)
    this.name = 'VaultError'
  }
}

export function formatRecoveryCode(rawCode: string): string {
  return rawCode.match(/.{1,4}/g)!.join('-')
}

function normalizeRecoveryCode(typedCode: string): string {
  return typedCode.toUpperCase().replace(/[^A-Z2-7]/g, '')
}

function assertPassphraseStrength(passphrase: string): void {
  if ([...passphrase.normalize('NFKC')].length < MINIMUM_PASSPHRASE_LENGTH) {
    throw new VaultError('weak_passphrase', `Use at least ${MINIMUM_PASSPHRASE_LENGTH} characters.`)
  }
}

export class VaultService {
  constructor(
    private readonly database: Database,
    private readonly scryptParametersForNewWraps: ScryptParameters,
    private readonly currentTimeMilliseconds: () => number = Date.now,
  ) {}

  isInitialized(): boolean {
    return this.readVaultRow() !== null
  }

  isTotpEnabled(): boolean {
    return this.readVaultRow()?.totp_secret_encrypted != null
  }

  /** Creates the vault. Returns the new data key and the one-time recovery code (formatted). */
  async initialize(passphrase: string): Promise<{ dataEncryptionKey: Buffer; recoveryCode: string }> {
    if (this.isInitialized()) throw new VaultError('vault_exists', 'This journal is already set up.')
    assertPassphraseStrength(passphrase)
    const dataEncryptionKey = generateDataEncryptionKey()
    const rawRecoveryCode = encodeBase32(generateRandomBytes(RECOVERY_CODE_BYTES))
    const passphraseSalt = generateRandomBytes(SALT_BYTES)
    const recoverySalt = generateRandomBytes(SALT_BYTES)
    const passphraseKeyEncryptionKey = await deriveKeyEncryptionKey(passphrase, passphraseSalt, this.scryptParametersForNewWraps)
    const recoveryKeyEncryptionKey = await deriveKeyEncryptionKey(rawRecoveryCode, recoverySalt, this.scryptParametersForNewWraps)
    this.database
      .prepare(
        `INSERT INTO vault (singleton_id, created_at, scrypt_cost_factor_n, scrypt_block_size_r, scrypt_parallelization_p,
           passphrase_salt, passphrase_wrapped_key, recovery_salt, recovery_wrapped_key)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date(this.currentTimeMilliseconds()).toISOString(),
        this.scryptParametersForNewWraps.costFactorN,
        this.scryptParametersForNewWraps.blockSizeR,
        this.scryptParametersForNewWraps.parallelizationP,
        passphraseSalt,
        encryptBytes(passphraseKeyEncryptionKey, dataEncryptionKey, WRAPPED_KEY_AAD_PASSPHRASE),
        recoverySalt,
        encryptBytes(recoveryKeyEncryptionKey, dataEncryptionKey, WRAPPED_KEY_AAD_RECOVERY),
      )
    passphraseKeyEncryptionKey.fill(0)
    recoveryKeyEncryptionKey.fill(0)
    return { dataEncryptionKey, recoveryCode: formatRecoveryCode(rawRecoveryCode) }
  }

  /**
   * Unwraps the data key with the passphrase, then checks the authenticator code
   * if one is enrolled. The authenticator secret is itself encrypted with the
   * data key, so it can only be checked after the passphrase is proven.
   */
  async unlockWithPassphrase(passphrase: string, totpCode: string | undefined): Promise<Buffer> {
    const vaultRow = this.requireVaultRow()
    // Ask for the code before checking the passphrase, so this endpoint never
    // confirms a correct passphrase to someone who lacks the authenticator.
    if (vaultRow.totp_secret_encrypted && !totpCode) {
      throw new VaultError('totp_required', 'Enter the 6-digit code from your authenticator app.')
    }
    const dataEncryptionKey = await this.unwrapDataEncryptionKey(
      passphrase,
      vaultRow.passphrase_salt,
      vaultRow.passphrase_wrapped_key,
      WRAPPED_KEY_AAD_PASSPHRASE,
      vaultRow,
    )
    if (vaultRow.totp_secret_encrypted) {
      const totpSecret = decryptBytes(dataEncryptionKey, vaultRow.totp_secret_encrypted, TOTP_SECRET_AAD)
      const acceptedCounter = verifyTotpCode(
        totpSecret,
        totpCode ?? '',
        this.currentTimeMilliseconds(),
        vaultRow.totp_last_accepted_counter,
      )
      totpSecret.fill(0)
      if (acceptedCounter === null) {
        dataEncryptionKey.fill(0)
        throw new VaultError('wrong_credentials', 'That passphrase or code is not right.')
      }
      this.database.prepare('UPDATE vault SET totp_last_accepted_counter = ? WHERE singleton_id = 1').run(acceptedCounter)
    }
    return dataEncryptionKey
  }

  async verifyPassphrase(passphrase: string): Promise<void> {
    const vaultRow = this.requireVaultRow()
    const dataEncryptionKey = await this.unwrapDataEncryptionKey(
      passphrase,
      vaultRow.passphrase_salt,
      vaultRow.passphrase_wrapped_key,
      WRAPPED_KEY_AAD_PASSPHRASE,
      vaultRow,
    )
    dataEncryptionKey.fill(0)
  }

  async changePassphrase(currentPassphrase: string, newPassphrase: string): Promise<void> {
    assertPassphraseStrength(newPassphrase)
    const vaultRow = this.requireVaultRow()
    const dataEncryptionKey = await this.unwrapDataEncryptionKey(
      currentPassphrase,
      vaultRow.passphrase_salt,
      vaultRow.passphrase_wrapped_key,
      WRAPPED_KEY_AAD_PASSPHRASE,
      vaultRow,
    )
    await this.rewrapWithPassphrase(dataEncryptionKey, newPassphrase)
    dataEncryptionKey.fill(0)
  }

  /**
   * Lost passphrase or lost authenticator: the recovery code unwraps the data key,
   * sets a new passphrase, turns off the authenticator (so a lost phone can't lock
   * you out) and issues a fresh recovery code — the used one is retired.
   */
  async recoverWithRecoveryCode(
    typedRecoveryCode: string,
    newPassphrase: string,
  ): Promise<{ dataEncryptionKey: Buffer; newRecoveryCode: string }> {
    assertPassphraseStrength(newPassphrase)
    const vaultRow = this.requireVaultRow()
    const dataEncryptionKey = await this.unwrapDataEncryptionKey(
      normalizeRecoveryCode(typedRecoveryCode),
      vaultRow.recovery_salt,
      vaultRow.recovery_wrapped_key,
      WRAPPED_KEY_AAD_RECOVERY,
      vaultRow,
    )
    await this.rewrapWithPassphrase(dataEncryptionKey, newPassphrase)
    const newRecoveryCode = await this.rewrapWithNewRecoveryCode(dataEncryptionKey)
    this.database
      .prepare('UPDATE vault SET totp_secret_encrypted = NULL, totp_last_accepted_counter = NULL WHERE singleton_id = 1')
      .run()
    return { dataEncryptionKey, newRecoveryCode }
  }

  async regenerateRecoveryCode(dataEncryptionKey: Buffer): Promise<string> {
    this.requireVaultRow()
    return this.rewrapWithNewRecoveryCode(dataEncryptionKey)
  }

  createPendingTotpSecret(): { secret: Buffer; secretBase32: string } {
    const secret = generateRandomBytes(20)
    return { secret, secretBase32: encodeBase32(secret) }
  }

  confirmTotpEnrollment(dataEncryptionKey: Buffer, pendingSecret: Buffer, submittedCode: string): void {
    const acceptedCounter = verifyTotpCode(pendingSecret, submittedCode, this.currentTimeMilliseconds(), null)
    if (acceptedCounter === null) throw new VaultError('totp_invalid', 'That code did not match. Check the time on your phone and try the next code.')
    this.database
      .prepare('UPDATE vault SET totp_secret_encrypted = ?, totp_last_accepted_counter = ? WHERE singleton_id = 1')
      .run(encryptBytes(dataEncryptionKey, pendingSecret, TOTP_SECRET_AAD), acceptedCounter)
  }

  disableTotp(): void {
    this.database
      .prepare('UPDATE vault SET totp_secret_encrypted = NULL, totp_last_accepted_counter = NULL WHERE singleton_id = 1')
      .run()
  }

  /** Exposed for tests: decode a base32 authenticator secret. */
  static decodeTotpSecret(secretBase32: string): Buffer {
    return decodeBase32(secretBase32)
  }

  private async rewrapWithPassphrase(dataEncryptionKey: Buffer, newPassphrase: string): Promise<void> {
    const passphraseSalt = generateRandomBytes(SALT_BYTES)
    const keyEncryptionKey = await deriveKeyEncryptionKey(newPassphrase, passphraseSalt, this.storedScryptParameters())
    this.database
      .prepare('UPDATE vault SET passphrase_salt = ?, passphrase_wrapped_key = ? WHERE singleton_id = 1')
      .run(passphraseSalt, encryptBytes(keyEncryptionKey, dataEncryptionKey, WRAPPED_KEY_AAD_PASSPHRASE))
    keyEncryptionKey.fill(0)
  }

  private async rewrapWithNewRecoveryCode(dataEncryptionKey: Buffer): Promise<string> {
    const rawRecoveryCode = encodeBase32(generateRandomBytes(RECOVERY_CODE_BYTES))
    const recoverySalt = generateRandomBytes(SALT_BYTES)
    const keyEncryptionKey = await deriveKeyEncryptionKey(rawRecoveryCode, recoverySalt, this.storedScryptParameters())
    this.database
      .prepare('UPDATE vault SET recovery_salt = ?, recovery_wrapped_key = ? WHERE singleton_id = 1')
      .run(recoverySalt, encryptBytes(keyEncryptionKey, dataEncryptionKey, WRAPPED_KEY_AAD_RECOVERY))
    keyEncryptionKey.fill(0)
    return formatRecoveryCode(rawRecoveryCode)
  }

  /**
   * Both key wraps use the scrypt parameters stored at setup. They are fixed for
   * the life of the vault so the two wraps can never disagree;
   * REFRAME_SCRYPT_N only affects a new vault.
   */
  private storedScryptParameters(): ScryptParameters {
    const vaultRow = this.requireVaultRow()
    return {
      costFactorN: vaultRow.scrypt_cost_factor_n,
      blockSizeR: vaultRow.scrypt_block_size_r,
      parallelizationP: vaultRow.scrypt_parallelization_p,
    }
  }

  private async unwrapDataEncryptionKey(
    secretText: string,
    salt: Uint8Array,
    wrappedKey: Uint8Array,
    additionalAuthenticatedData: string,
    vaultRow: VaultRow,
  ): Promise<Buffer> {
    const keyEncryptionKey = await deriveKeyEncryptionKey(secretText, Buffer.from(salt), {
      costFactorN: vaultRow.scrypt_cost_factor_n,
      blockSizeR: vaultRow.scrypt_block_size_r,
      parallelizationP: vaultRow.scrypt_parallelization_p,
    })
    try {
      return decryptBytes(keyEncryptionKey, wrappedKey, additionalAuthenticatedData)
    } catch (error) {
      if (error instanceof DecryptionFailedError) {
        throw new VaultError('wrong_credentials', 'That passphrase or code is not right.')
      }
      throw error
    } finally {
      keyEncryptionKey.fill(0)
    }
  }

  private readVaultRow(): VaultRow | null {
    return (this.database.prepare('SELECT * FROM vault WHERE singleton_id = 1').get() as VaultRow | undefined) ?? null
  }

  private requireVaultRow(): VaultRow {
    const vaultRow = this.readVaultRow()
    if (!vaultRow) throw new VaultError('vault_missing', 'This journal has not been set up yet.')
    return vaultRow
  }
}

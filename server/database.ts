import { mkdirSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Schema. Everything a person wrote lives in `payload` columns as AES-256-GCM
 * ciphertext. Plaintext columns are limited to random ids and the vault's own
 * key-wrapping material, plus the access log (timestamps, event names, IPs).
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE vault (
     singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
     created_at TEXT NOT NULL,
     scrypt_cost_factor_n INTEGER NOT NULL,
     scrypt_block_size_r INTEGER NOT NULL,
     scrypt_parallelization_p INTEGER NOT NULL,
     passphrase_salt BLOB NOT NULL,
     passphrase_wrapped_key BLOB NOT NULL,
     recovery_salt BLOB NOT NULL,
     recovery_wrapped_key BLOB NOT NULL,
     totp_secret_encrypted BLOB,
     totp_last_accepted_counter INTEGER
   );
   CREATE TABLE tags (id TEXT PRIMARY KEY, payload BLOB NOT NULL);
   CREATE TABLE entries (id TEXT PRIMARY KEY, payload BLOB NOT NULL);
   CREATE TABLE audit_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     event TEXT NOT NULL,
     ip_address TEXT NOT NULL,
     user_agent TEXT NOT NULL
   );`,
]

export type Database = DatabaseSync

export function openDatabase(databaseFilePath: string): Database {
  if (databaseFilePath !== ':memory:') {
    mkdirSync(path.dirname(databaseFilePath), { recursive: true, mode: 0o700 })
  }
  const database = new DatabaseSync(databaseFilePath)
  if (databaseFilePath !== ':memory:') {
    try {
      chmodSync(databaseFilePath, 0o600)
    } catch {
      // Non-fatal: some bind mounts do not allow chmod.
    }
  }
  database.exec('PRAGMA journal_mode = WAL;')
  database.exec('PRAGMA foreign_keys = ON;')
  // Overwrite deleted content instead of leaving it in free pages.
  database.exec('PRAGMA secure_delete = ON;')
  runMigrations(database)
  return database
}

function runMigrations(database: Database): void {
  const currentVersionRow = database.prepare('PRAGMA user_version').get() as { user_version: number }
  let schemaVersion = currentVersionRow.user_version
  while (schemaVersion < MIGRATIONS.length) {
    const migrationSql = MIGRATIONS[schemaVersion]!
    database.exec('BEGIN')
    try {
      database.exec(migrationSql)
      database.exec(`PRAGMA user_version = ${schemaVersion + 1}`)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    schemaVersion += 1
  }
}

import { randomUUID } from 'node:crypto'
import type { Database } from './database'
import { decryptJson, encryptJson, recordAdditionalAuthenticatedData } from './crypto/envelope'
import type { AuditEvent, Entry, EntryInput, Tag, TagInput } from '../shared/model'
import { TAG_KINDS } from '../shared/model'
import { SEED_TAG_NAMES_BY_KIND } from './seedTags'

/**
 * Every read decrypts and every write encrypts with the caller's session key.
 * The whole journal is decrypted for list views and insights; at personal scale
 * (thousands of entries) AES-GCM makes that a few milliseconds, and it means no
 * plaintext index ever has to exist on disk.
 */

type StoredTag = Omit<Tag, 'id'>
type StoredEntry = Omit<Entry, 'id'>

export class RecordNotFoundError extends Error {}
export class RecordConflictError extends Error {}
export class RecordValidationError extends Error {}

export class TagRepository {
  constructor(private readonly database: Database) {}

  listAll(dataEncryptionKey: Buffer): Tag[] {
    const rows = this.database.prepare('SELECT id, payload FROM tags').all() as { id: string; payload: Uint8Array }[]
    return rows
      .map((row) => ({
        id: row.id,
        ...decryptJson<StoredTag>(dataEncryptionKey, row.payload, recordAdditionalAuthenticatedData('tags', row.id)),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  create(dataEncryptionKey: Buffer, tagInput: TagInput, nowIsoTimestamp: string): Tag {
    this.assertNameIsUnique(dataEncryptionKey, tagInput, null)
    const tagId = randomUUID()
    const storedTag: StoredTag = { ...tagInput, createdAt: nowIsoTimestamp }
    this.database
      .prepare('INSERT INTO tags (id, payload) VALUES (?, ?)')
      .run(tagId, encryptJson(dataEncryptionKey, storedTag, recordAdditionalAuthenticatedData('tags', tagId)))
    return { id: tagId, ...storedTag }
  }

  replace(dataEncryptionKey: Buffer, tagId: string, tagInput: TagInput): Tag {
    const existingTag = this.listAll(dataEncryptionKey).find((tag) => tag.id === tagId)
    if (!existingTag) throw new RecordNotFoundError('Tag not found')
    if (existingTag.kind !== tagInput.kind) throw new RecordValidationError('A tag cannot change kind')
    this.assertNameIsUnique(dataEncryptionKey, tagInput, tagId)
    const storedTag: StoredTag = { ...tagInput, createdAt: existingTag.createdAt }
    this.database
      .prepare('UPDATE tags SET payload = ? WHERE id = ?')
      .run(encryptJson(dataEncryptionKey, storedTag, recordAdditionalAuthenticatedData('tags', tagId)), tagId)
    return { id: tagId, ...storedTag }
  }

  delete(tagId: string): void {
    const result = this.database.prepare('DELETE FROM tags WHERE id = ?').run(tagId)
    if (result.changes === 0) throw new RecordNotFoundError('Tag not found')
  }

  seedDefaults(dataEncryptionKey: Buffer, nowIsoTimestamp: string): void {
    for (const tagKind of TAG_KINDS) {
      for (const tagName of SEED_TAG_NAMES_BY_KIND[tagKind]) {
        this.create(dataEncryptionKey, { kind: tagKind, name: tagName, archived: false }, nowIsoTimestamp)
      }
    }
  }

  private assertNameIsUnique(dataEncryptionKey: Buffer, tagInput: TagInput, ignoredTagId: string | null): void {
    const normalizedName = tagInput.name.trim().toLocaleLowerCase()
    const duplicateTag = this.listAll(dataEncryptionKey).find(
      (tag) => tag.kind === tagInput.kind && tag.id !== ignoredTagId && tag.name.trim().toLocaleLowerCase() === normalizedName,
    )
    if (duplicateTag) throw new RecordConflictError(`There is already a tag called "${duplicateTag.name}" here`)
  }
}

export class EntryRepository {
  constructor(private readonly database: Database) {}

  listAll(dataEncryptionKey: Buffer): Entry[] {
    const rows = this.database.prepare('SELECT id, payload FROM entries').all() as { id: string; payload: Uint8Array }[]
    return rows
      .map((row) => ({
        id: row.id,
        ...decryptJson<StoredEntry>(dataEncryptionKey, row.payload, recordAdditionalAuthenticatedData('entries', row.id)),
      }))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
  }

  get(dataEncryptionKey: Buffer, entryId: string): Entry {
    const row = this.database.prepare('SELECT id, payload FROM entries WHERE id = ?').get(entryId) as
      | { id: string; payload: Uint8Array }
      | undefined
    if (!row) throw new RecordNotFoundError('Entry not found')
    return {
      id: row.id,
      ...decryptJson<StoredEntry>(dataEncryptionKey, row.payload, recordAdditionalAuthenticatedData('entries', row.id)),
    }
  }

  create(dataEncryptionKey: Buffer, entryInput: EntryInput, nowIsoTimestamp: string): Entry {
    const entryId = randomUUID()
    const storedEntry: StoredEntry = { ...entryInput, createdAt: nowIsoTimestamp, updatedAt: nowIsoTimestamp }
    this.database
      .prepare('INSERT INTO entries (id, payload) VALUES (?, ?)')
      .run(entryId, encryptJson(dataEncryptionKey, storedEntry, recordAdditionalAuthenticatedData('entries', entryId)))
    return { id: entryId, ...storedEntry }
  }

  replace(dataEncryptionKey: Buffer, entryId: string, entryInput: EntryInput, nowIsoTimestamp: string): Entry {
    const existingEntry = this.get(dataEncryptionKey, entryId)
    const storedEntry: StoredEntry = { ...entryInput, createdAt: existingEntry.createdAt, updatedAt: nowIsoTimestamp }
    this.database
      .prepare('UPDATE entries SET payload = ? WHERE id = ?')
      .run(encryptJson(dataEncryptionKey, storedEntry, recordAdditionalAuthenticatedData('entries', entryId)), entryId)
    return { id: entryId, ...storedEntry }
  }

  delete(entryId: string): void {
    const result = this.database.prepare('DELETE FROM entries WHERE id = ?').run(entryId)
    if (result.changes === 0) throw new RecordNotFoundError('Entry not found')
  }
}

/** Every tag an entry references must exist and be of the field's kind. */
export function assertEntryTagReferencesAreValid(entryInput: EntryInput, allTags: Tag[]): void {
  const tagKindById = new Map(allTags.map((tag) => [tag.id, tag.kind]))
  const referencesByExpectedKind: [string, string[]][] = [
    ['context', entryInput.contextTagIds],
    ['emotion', entryInput.emotions.map((emotionRating) => emotionRating.tagId)],
    ['sensation', entryInput.sensationTagIds],
    ['pattern', entryInput.patternTagIds],
    ['technique', entryInput.techniqueTagIds],
  ]
  for (const [expectedKind, referencedTagIds] of referencesByExpectedKind) {
    if (new Set(referencedTagIds).size !== referencedTagIds.length) {
      throw new RecordValidationError(`A ${expectedKind} tag is listed twice`)
    }
    for (const referencedTagId of referencedTagIds) {
      if (tagKindById.get(referencedTagId) !== expectedKind) {
        throw new RecordValidationError(`Unknown ${expectedKind} tag ${referencedTagId}`)
      }
    }
  }
}

export function countTagUsage(allEntries: Entry[]): Map<string, number> {
  const usageCountByTagId = new Map<string, number>()
  const increment = (tagId: string) => usageCountByTagId.set(tagId, (usageCountByTagId.get(tagId) ?? 0) + 1)
  for (const entry of allEntries) {
    entry.contextTagIds.forEach(increment)
    entry.emotions.forEach((emotionRating) => increment(emotionRating.tagId))
    entry.sensationTagIds.forEach(increment)
    entry.patternTagIds.forEach(increment)
    entry.techniqueTagIds.forEach(increment)
  }
  return usageCountByTagId
}

const MAXIMUM_AUDIT_ROWS = 2000

export class AuditLog {
  constructor(private readonly database: Database) {}

  record(event: string, ipAddress: string, userAgent: string, nowIsoTimestamp: string): void {
    this.database
      .prepare('INSERT INTO audit_log (at, event, ip_address, user_agent) VALUES (?, ?, ?, ?)')
      .run(nowIsoTimestamp, event, ipAddress.slice(0, 64), userAgent.slice(0, 200))
    this.database
      .prepare('DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - ?')
      .run(MAXIMUM_AUDIT_ROWS)
  }

  listRecent(limit: number): AuditEvent[] {
    const rows = this.database
      .prepare('SELECT id, at, event, ip_address, user_agent FROM audit_log ORDER BY id DESC LIMIT ?')
      .all(limit) as { id: number; at: string; event: string; ip_address: string; user_agent: string }[]
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      event: row.event,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
    }))
  }
}

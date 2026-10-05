// Plain types shared by the server and the client. Validation lives in
// server/schemas.ts so the client bundle does not carry the validator.

export const TAG_KINDS = ['context', 'emotion', 'sensation', 'pattern', 'technique'] as const
export type TagKind = (typeof TAG_KINDS)[number]

export const TAG_KIND_LABELS: Record<TagKind, { singular: string; plural: string }> = {
  context: { singular: 'Context', plural: 'Contexts' },
  emotion: { singular: 'Feeling', plural: 'Feelings' },
  sensation: { singular: 'Body sensation', plural: 'Body sensations' },
  pattern: { singular: 'Thinking pattern', plural: 'Thinking patterns' },
  technique: { singular: 'Response', plural: 'Responses' },
}

export interface Tag {
  id: string
  kind: TagKind
  name: string
  archived: boolean
  createdAt: string
}

export interface TagInput {
  kind: TagKind
  name: string
  archived: boolean
}

export interface EmotionRating {
  tagId: string
  /** How strong the feeling was in the moment, 0-100. */
  intensityBefore: number
  /** Re-rating after working through the record, 0-100, or null if not re-rated yet. */
  intensityAfter: number | null
}

export type EntryStatus = 'draft' | 'complete'

export interface EntryInput {
  occurredAt: string
  status: EntryStatus
  situation: string
  contextTagIds: string[]
  emotions: EmotionRating[]
  sensationTagIds: string[]
  bodyNotes: string
  thoughts: string
  patternTagIds: string[]
  alternativeThought: string
  response: string
  techniqueTagIds: string[]
}

export interface Entry extends EntryInput {
  id: string
  createdAt: string
  updatedAt: string
}

export interface VaultStatus {
  vaultInitialized: boolean
  unlocked: boolean
  totpEnabled: boolean
  sessionIdleMinutes: number
}

export interface AuditEvent {
  id: number
  at: string
  event: string
  ipAddress: string
  userAgent: string
}

export function createEmptyEntryInput(now: Date = new Date()): EntryInput {
  return {
    occurredAt: now.toISOString(),
    status: 'draft',
    situation: '',
    contextTagIds: [],
    emotions: [],
    sensationTagIds: [],
    bodyNotes: '',
    thoughts: '',
    patternTagIds: [],
    alternativeThought: '',
    response: '',
    techniqueTagIds: [],
  }
}

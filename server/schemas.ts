import { z } from 'zod'
import { TAG_KINDS } from '../shared/model'

// Full-replacement schemas only (PUT, never PATCH), and no `.default()` anywhere:
// defaults on partial update schemas silently overwrite fields the client never sent.

const tagIdSchema = z.string().uuid()
const tagIdListSchema = z.array(tagIdSchema).max(40)
const longTextSchema = z.string().max(10_000)

export const emotionRatingSchema = z.object({
  tagId: tagIdSchema,
  intensityBefore: z.number().int().min(0).max(100),
  intensityAfter: z.number().int().min(0).max(100).nullable(),
})

export const entryInputSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }),
  status: z.enum(['draft', 'complete']),
  situation: longTextSchema,
  contextTagIds: tagIdListSchema,
  emotions: z.array(emotionRatingSchema).max(16),
  sensationTagIds: tagIdListSchema,
  bodyNotes: longTextSchema,
  thoughts: longTextSchema,
  patternTagIds: tagIdListSchema,
  alternativeThought: longTextSchema,
  response: longTextSchema,
  techniqueTagIds: tagIdListSchema,
})

export const tagInputSchema = z.object({
  kind: z.enum(TAG_KINDS),
  name: z.string().trim().min(1).max(60),
  archived: z.boolean(),
})

export const passphraseSchema = z.string().min(1).max(1024)

export const setupRequestSchema = z.object({
  setupToken: z.string().min(1).max(200),
  passphrase: passphraseSchema,
})

export const loginRequestSchema = z.object({
  passphrase: passphraseSchema,
  totpCode: z.string().max(12).optional(),
})

export const recoverRequestSchema = z.object({
  recoveryCode: z.string().min(1).max(200),
  newPassphrase: passphraseSchema,
})

export const changePassphraseRequestSchema = z.object({
  currentPassphrase: passphraseSchema,
  newPassphrase: passphraseSchema,
})

export const passphraseConfirmationSchema = z.object({
  passphrase: passphraseSchema,
})

export const totpConfirmRequestSchema = z.object({
  code: z.string().min(6).max(12),
})

export const clientExportAuditSchema = z.object({
  kind: z.enum(['report', 'guava_csv']),
})

import type { Entry, Tag } from '../shared/model'
import { escapeCsvField } from '../shared/csv'

const CSV_COLUMNS = [
  'occurred_at',
  'status',
  'situation',
  'contexts',
  'feelings_before',
  'feelings_after',
  'body_sensations',
  'body_notes',
  'thoughts',
  'thinking_patterns',
  'alternative_thought',
  'response',
  'responses_used',
] as const


export function buildEntriesCsv(allEntries: Entry[], allTags: Tag[]): string {
  const tagNameById = new Map(allTags.map((tag) => [tag.id, tag.name]))
  const tagNames = (tagIds: string[]) => tagIds.map((tagId) => tagNameById.get(tagId) ?? 'Unknown tag').join('; ')
  const csvLines = [CSV_COLUMNS.join(',')]
  for (const entry of allEntries) {
    const rowValues: Record<(typeof CSV_COLUMNS)[number], string> = {
      occurred_at: entry.occurredAt,
      status: entry.status,
      situation: entry.situation,
      contexts: tagNames(entry.contextTagIds),
      feelings_before: entry.emotions
        .map((emotionRating) => `${tagNameById.get(emotionRating.tagId) ?? 'Unknown tag'} ${emotionRating.intensityBefore}`)
        .join('; '),
      feelings_after: entry.emotions
        .filter((emotionRating) => emotionRating.intensityAfter !== null)
        .map((emotionRating) => `${tagNameById.get(emotionRating.tagId) ?? 'Unknown tag'} ${emotionRating.intensityAfter}`)
        .join('; '),
      body_sensations: tagNames(entry.sensationTagIds),
      body_notes: entry.bodyNotes,
      thoughts: entry.thoughts,
      thinking_patterns: tagNames(entry.patternTagIds),
      alternative_thought: entry.alternativeThought,
      response: entry.response,
      responses_used: tagNames(entry.techniqueTagIds),
    }
    csvLines.push(CSV_COLUMNS.map((columnName) => escapeCsvField(rowValues[columnName])).join(','))
  }
  // BOM so spreadsheet apps read it as UTF-8.
  return '﻿' + csvLines.join('\r\n') + '\r\n'
}

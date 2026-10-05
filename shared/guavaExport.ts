import type { Entry, Tag } from './model'
import { buildCsvText } from './csv'

/**
 * A "long" CSV for Guava's custom CSV import: one row per measurement, with
 * date, time and a full ISO timestamp in separate columns so whichever date
 * mapping the importer asks for is available.
 *
 * Each feeling becomes its own metric (e.g. "Anxious"), rated 0-100 at the
 * time, and "<feeling> (after)" for the re-rating. A "Thought record" row (value 1)
 * per entry carries a short text summary in Notes, only when written text is included.
 *
 * Guava's importer spec isn't published; this is the shape generic
 * column-mapping importers accept. Times are the viewer's local time.
 */

export const GUAVA_CSV_COLUMNS = ['Date', 'Time', 'Timestamp', 'Metric', 'Value', 'Unit', 'Notes'] as const

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Local wall-clock parts plus an ISO 8601 timestamp carrying the local UTC offset. */
export function formatLocalDateParts(isoTimestamp: string): { localDate: string; localTime: string; isoWithOffset: string } {
  const date = new Date(isoTimestamp)
  const localDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const localTime = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const offsetMinutesEastOfUtc = -date.getTimezoneOffset()
  const offsetSign = offsetMinutesEastOfUtc >= 0 ? '+' : '-'
  const absoluteOffsetMinutes = Math.abs(offsetMinutesEastOfUtc)
  const offsetText = `${offsetSign}${pad(Math.floor(absoluteOffsetMinutes / 60))}:${pad(absoluteOffsetMinutes % 60)}`
  return { localDate, localTime, isoWithOffset: `${localDate}T${localTime}:${pad(date.getSeconds())}${offsetText}` }
}

export function buildGuavaCsv(entries: Entry[], tagById: Map<string, Tag>, options: { includeWrittenText: boolean }): string {
  const tagNames = (tagIds: string[]) => tagIds.map((tagId) => tagById.get(tagId)?.name ?? 'Deleted tag').join(', ')
  const dataRows: string[][] = []

  for (const entry of entries) {
    const { localDate, localTime, isoWithOffset } = formatLocalDateParts(entry.occurredAt)
    const rowFor = (metric: string, value: string, unit: string, notes: string) => [
      localDate,
      localTime,
      isoWithOffset,
      metric,
      value,
      unit,
      notes,
    ]

    for (const emotionRating of entry.emotions) {
      const feelingName = tagById.get(emotionRating.tagId)?.name ?? 'Feeling'
      dataRows.push(rowFor(feelingName, String(emotionRating.intensityBefore), '0-100', ''))
      if (emotionRating.intensityAfter !== null) {
        dataRows.push(rowFor(`${feelingName} (after)`, String(emotionRating.intensityAfter), '0-100', ''))
      }
    }

    const summaryParts: string[] = []
    if (entry.contextTagIds.length > 0) summaryParts.push(`Context: ${tagNames(entry.contextTagIds)}`)
    if (entry.sensationTagIds.length > 0) summaryParts.push(`Body: ${tagNames(entry.sensationTagIds)}`)
    if (entry.patternTagIds.length > 0) summaryParts.push(`Thinking patterns: ${tagNames(entry.patternTagIds)}`)
    if (entry.techniqueTagIds.length > 0) summaryParts.push(`Responses: ${tagNames(entry.techniqueTagIds)}`)
    if (options.includeWrittenText) {
      if (entry.situation.trim()) summaryParts.unshift(`Situation: ${entry.situation.trim()}`)
      if (entry.thoughts.trim()) summaryParts.push(`Thoughts: ${entry.thoughts.trim()}`)
      if (entry.alternativeThought.trim()) summaryParts.push(`Balanced view: ${entry.alternativeThought.trim()}`)
      if (entry.response.trim()) summaryParts.push(`What I did: ${entry.response.trim()}`)
    }
    dataRows.push(rowFor('Thought record', '1', 'count', summaryParts.join(' | ')))
  }

  return buildCsvText(GUAVA_CSV_COLUMNS, dataRows)
}

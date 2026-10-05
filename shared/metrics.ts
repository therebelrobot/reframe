import type { Entry, Tag, TagKind } from './model'

/**
 * Insights are computed in the browser, in the viewer's own time zone, from
 * the decrypted entries the client already holds. Nothing here touches the server.
 */

export type InsightRange = 30 | 90 | 365 | 'all'

export interface WeeklyIntensityPoint {
  weekStart: Date
  entryCount: number
  /** Mean of each entry's strongest starting rating, or null if no ratings that week. */
  averageStartingIntensity: number | null
  /** Mean of each entry's strongest re-rating, or null if none were re-rated. */
  averageEndingIntensity: number | null
}

export interface TagFrequency {
  tagId: string
  tagName: string
  count: number
}

export interface TechniqueShift {
  tagId: string
  tagName: string
  entryCount: number
  /** Mean drop (before − after) across re-rated feelings in entries that used this response. */
  averageDrop: number
}

export interface InsightSummary {
  entryCount: number
  draftCount: number
  averageStartingIntensity: number | null
  averageDrop: number | null
  reratedFeelingCount: number
}

const MILLISECONDS_PER_DAY = 86_400_000

export function filterEntriesToRange(allEntries: Entry[], range: InsightRange, now: Date): Entry[] {
  if (range === 'all') return allEntries
  const earliestIncludedMilliseconds = startOfLocalDay(now).getTime() - (range - 1) * MILLISECONDS_PER_DAY
  return allEntries.filter((entry) => Date.parse(entry.occurredAt) >= earliestIncludedMilliseconds)
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

export function strongestStartingIntensity(entry: Entry): number | null {
  return entry.emotions.length === 0 ? null : Math.max(...entry.emotions.map((emotionRating) => emotionRating.intensityBefore))
}

export function strongestEndingIntensity(entry: Entry): number | null {
  const reratedValues = entry.emotions
    .map((emotionRating) => emotionRating.intensityAfter)
    .filter((intensityAfter): intensityAfter is number => intensityAfter !== null)
  return reratedValues.length === 0 ? null : Math.max(...reratedValues)
}

function feelingDrops(entry: Entry): number[] {
  return entry.emotions
    .filter((emotionRating) => emotionRating.intensityAfter !== null)
    .map((emotionRating) => emotionRating.intensityBefore - (emotionRating.intensityAfter as number))
}

export function summarizeEntries(entriesInRange: Entry[]): InsightSummary {
  const allDrops = entriesInRange.flatMap(feelingDrops)
  return {
    entryCount: entriesInRange.length,
    draftCount: entriesInRange.filter((entry) => entry.status === 'draft').length,
    averageStartingIntensity: mean(
      entriesInRange.map(strongestStartingIntensity).filter((value): value is number => value !== null),
    ),
    averageDrop: mean(allDrops),
    reratedFeelingCount: allDrops.length,
  }
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Weeks start on Monday, local time. */
export function startOfLocalWeek(date: Date): Date {
  const dayStart = startOfLocalDay(date)
  const daysSinceMonday = (dayStart.getDay() + 6) % 7
  return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() - daysSinceMonday)
}

export function buildWeeklyIntensitySeries(entriesInRange: Entry[], range: InsightRange, now: Date): WeeklyIntensityPoint[] {
  const firstDay =
    range === 'all'
      ? entriesInRange.length === 0
        ? now
        : new Date(Math.min(...entriesInRange.map((entry) => Date.parse(entry.occurredAt))))
      : new Date(startOfLocalDay(now).getTime() - (range - 1) * MILLISECONDS_PER_DAY)
  return buildWeeklyIntensitySeriesBetween(entriesInRange, firstDay, now)
}

/** Weekly points for every Monday-start week touching [firstDay, lastDay], local time. */
export function buildWeeklyIntensitySeriesBetween(entriesInRange: Entry[], firstDay: Date, lastDay: Date): WeeklyIntensityPoint[] {
  const firstWeekStart = startOfLocalWeek(firstDay)
  const lastWeekStart = startOfLocalWeek(lastDay)
  const entriesByWeekKey = new Map<number, Entry[]>()
  for (const entry of entriesInRange) {
    const weekKey = startOfLocalWeek(new Date(entry.occurredAt)).getTime()
    entriesByWeekKey.set(weekKey, [...(entriesByWeekKey.get(weekKey) ?? []), entry])
  }
  const weeklyPoints: WeeklyIntensityPoint[] = []
  for (
    let weekStart = firstWeekStart;
    weekStart.getTime() <= lastWeekStart.getTime();
    weekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7)
  ) {
    const weekEntries = entriesByWeekKey.get(weekStart.getTime()) ?? []
    weeklyPoints.push({
      weekStart,
      entryCount: weekEntries.length,
      averageStartingIntensity: mean(weekEntries.map(strongestStartingIntensity).filter((value): value is number => value !== null)),
      averageEndingIntensity: mean(weekEntries.map(strongestEndingIntensity).filter((value): value is number => value !== null)),
    })
  }
  return weeklyPoints
}

export function tagIdsOfKind(entry: Entry, tagKind: TagKind): string[] {
  switch (tagKind) {
    case 'context':
      return entry.contextTagIds
    case 'emotion':
      return entry.emotions.map((emotionRating) => emotionRating.tagId)
    case 'sensation':
      return entry.sensationTagIds
    case 'pattern':
      return entry.patternTagIds
    case 'technique':
      return entry.techniqueTagIds
  }
}

export function countTagFrequency(entriesInRange: Entry[], allTags: Tag[], tagKind: TagKind, limit = 8): TagFrequency[] {
  const tagNameById = new Map(allTags.map((tag) => [tag.id, tag.name]))
  const countByTagId = new Map<string, number>()
  for (const entry of entriesInRange) {
    for (const tagId of tagIdsOfKind(entry, tagKind)) countByTagId.set(tagId, (countByTagId.get(tagId) ?? 0) + 1)
  }
  return [...countByTagId.entries()]
    .map(([tagId, count]) => ({ tagId, tagName: tagNameById.get(tagId) ?? 'Deleted tag', count }))
    .sort((left, right) => right.count - left.count || left.tagName.localeCompare(right.tagName))
    .slice(0, limit)
}

/** Only responses used in at least `minimumEntries` re-rated entries are listed; fewer is noise. */
export function measureTechniqueShifts(entriesInRange: Entry[], allTags: Tag[], minimumEntries = 2): TechniqueShift[] {
  const tagNameById = new Map(allTags.map((tag) => [tag.id, tag.name]))
  const dropsByTagId = new Map<string, { entryCount: number; drops: number[] }>()
  for (const entry of entriesInRange) {
    const drops = feelingDrops(entry)
    if (drops.length === 0) continue
    for (const techniqueTagId of entry.techniqueTagIds) {
      const accumulator = dropsByTagId.get(techniqueTagId) ?? { entryCount: 0, drops: [] }
      accumulator.entryCount += 1
      accumulator.drops.push(...drops)
      dropsByTagId.set(techniqueTagId, accumulator)
    }
  }
  return [...dropsByTagId.entries()]
    .filter(([, accumulator]) => accumulator.entryCount >= minimumEntries)
    .map(([tagId, accumulator]) => ({
      tagId,
      tagName: tagNameById.get(tagId) ?? 'Deleted tag',
      entryCount: accumulator.entryCount,
      averageDrop: mean(accumulator.drops) ?? 0,
    }))
    .sort((left, right) => right.averageDrop - left.averageDrop)
}

export function countEntriesByHourOfDay(entriesInRange: Entry[]): number[] {
  const countsByHour = Array.from({ length: 24 }, () => 0)
  for (const entry of entriesInRange) countsByHour[new Date(entry.occurredAt).getHours()]! += 1
  return countsByHour
}

/** Entries whose local date falls between two YYYY-MM-DD dates, inclusive, oldest first. */
export function filterEntriesBetweenLocalDates(allEntries: Entry[], fromLocalDate: string, toLocalDate: string): Entry[] {
  const [fromYear, fromMonth, fromDay] = fromLocalDate.split('-').map(Number)
  const [toYear, toMonth, toDay] = toLocalDate.split('-').map(Number)
  const startMilliseconds = new Date(fromYear!, fromMonth! - 1, fromDay!).getTime()
  const endMilliseconds = new Date(toYear!, toMonth! - 1, toDay! + 1).getTime()
  return allEntries
    .filter((entry) => {
      const occurredMilliseconds = Date.parse(entry.occurredAt)
      return occurredMilliseconds >= startMilliseconds && occurredMilliseconds < endMilliseconds
    })
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
}

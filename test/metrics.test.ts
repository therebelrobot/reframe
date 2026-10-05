import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWeeklyIntensitySeries,
  countTagFrequency,
  filterEntriesToRange,
  measureTechniqueShifts,
  startOfLocalWeek,
  summarizeEntries,
} from '../shared/metrics'
import { createEmptyEntryInput, type Entry, type Tag } from '../shared/model'

function makeEntry(occurredAt: Date, overrides: Partial<Entry> = {}): Entry {
  return {
    ...createEmptyEntryInput(occurredAt),
    id: crypto.randomUUID(),
    createdAt: occurredAt.toISOString(),
    updatedAt: occurredAt.toISOString(),
    status: 'complete',
    ...overrides,
  }
}

const tags: Tag[] = [
  { id: 'anxious', kind: 'emotion', name: 'Anxious', archived: false, createdAt: '' },
  { id: 'breathing', kind: 'technique', name: 'Slow breathing', archived: false, createdAt: '' },
  { id: 'walk', kind: 'technique', name: 'Walk', archived: false, createdAt: '' },
]

test('weeks start on Monday in local time', () => {
  const wednesday = new Date(2026, 9, 7, 15, 0)
  const weekStart = startOfLocalWeek(wednesday)
  assert.equal(weekStart.getDay(), 1)
  assert.equal(weekStart.getDate(), 5)
  const sunday = new Date(2026, 9, 11, 23, 0)
  assert.equal(startOfLocalWeek(sunday).getDate(), 5)
})

test('summary uses the strongest feeling per entry and per-feeling drops', () => {
  const now = new Date(2026, 9, 5, 12)
  const entries = [
    makeEntry(new Date(2026, 9, 5, 9), {
      emotions: [
        { tagId: 'anxious', intensityBefore: 80, intensityAfter: 50 },
        { tagId: 'x', intensityBefore: 40, intensityAfter: null },
      ],
    }),
    makeEntry(new Date(2026, 9, 4, 9), { status: 'draft', emotions: [{ tagId: 'anxious', intensityBefore: 60, intensityAfter: 20 }] }),
    makeEntry(new Date(2026, 5, 1, 9), { emotions: [{ tagId: 'anxious', intensityBefore: 10, intensityAfter: 0 }] }),
  ]
  const inRange = filterEntriesToRange(entries, 30, now)
  assert.equal(inRange.length, 2)
  const summary = summarizeEntries(inRange)
  assert.equal(summary.averageStartingIntensity, 70)
  assert.equal(summary.averageDrop, 35)
  assert.equal(summary.draftCount, 1)
  assert.equal(summary.reratedFeelingCount, 2)
})

test('weekly series covers every week in range, including empty ones', () => {
  const now = new Date(2026, 9, 5, 12)
  const series = buildWeeklyIntensitySeries(
    [makeEntry(new Date(2026, 9, 5, 9), { emotions: [{ tagId: 'anxious', intensityBefore: 70, intensityAfter: 30 }] })],
    30,
    now,
  )
  assert.ok(series.length >= 5)
  assert.equal(series.at(-1)!.averageStartingIntensity, 70)
  assert.equal(series.at(-1)!.averageEndingIntensity, 30)
  assert.equal(series[0]!.averageStartingIntensity, null)
})

test('tag frequency and response shifts', () => {
  const day = new Date(2026, 9, 5, 9)
  const entries = [
    makeEntry(day, { techniqueTagIds: ['breathing'], emotions: [{ tagId: 'anxious', intensityBefore: 80, intensityAfter: 40 }] }),
    makeEntry(day, { techniqueTagIds: ['breathing', 'walk'], emotions: [{ tagId: 'anxious', intensityBefore: 60, intensityAfter: 40 }] }),
  ]
  assert.deepEqual(countTagFrequency(entries, tags, 'technique')[0], { tagId: 'breathing', tagName: 'Slow breathing', count: 2 })
  const shifts = measureTechniqueShifts(entries, tags)
  assert.equal(shifts.length, 1, 'walk has only one entry and is withheld')
  assert.equal(shifts[0]!.averageDrop, 30)
})

test('date-range filter is inclusive of both local days and sorts oldest first', async () => {
  const { filterEntriesBetweenLocalDates } = await import('../shared/metrics')
  const entries = [
    makeEntry(new Date(2026, 8, 30, 23, 59)),
    makeEntry(new Date(2026, 9, 1, 0, 0)),
    makeEntry(new Date(2026, 9, 5, 23, 59)),
    makeEntry(new Date(2026, 9, 6, 0, 0)),
  ]
  const filtered = filterEntriesBetweenLocalDates([...entries].reverse(), '2026-10-01', '2026-10-05')
  assert.deepEqual(filtered.map((entry) => entry.id), [entries[1]!.id, entries[2]!.id])
})

test('Guava CSV: one row per rating plus a record row, local time, notes only when allowed', async () => {
  const { buildGuavaCsv, GUAVA_CSV_COLUMNS } = await import('../shared/guavaExport')
  const tagById = new Map(tags.map((tag) => [tag.id, tag]))
  const entry = makeEntry(new Date(2026, 9, 4, 21, 15), {
    situation: '=SUM(A1) team sync, "long"',
    emotions: [{ tagId: 'anxious', intensityBefore: 80, intensityAfter: 35 }],
    techniqueTagIds: ['breathing'],
  })
  const withText = buildGuavaCsv([entry], tagById, { includeWrittenText: true })
  const lines = withText.replace('\uFEFF', '').trim().split('\r\n')
  assert.equal(lines[0], GUAVA_CSV_COLUMNS.join(','))
  assert.equal(lines.length, 4)
  assert.match(lines[1]!, /^2026-10-04,21:15,2026-10-04T21:15:00[+-]\d\d:\d\d,Anxious,80,0-100,$/)
  assert.match(lines[2]!, /,Anxious \(after\),35,0-100,$/)
  assert.ok(lines[3]!.includes('Thought record,1,count,"Situation: =SUM(A1) team sync, ""long"" | Responses: Slow breathing"'))
  const withoutText = buildGuavaCsv([entry], tagById, { includeWrittenText: false })
  assert.ok(!withoutText.includes('team sync'))
  assert.ok(withoutText.includes('Responses: Slow breathing'))
})

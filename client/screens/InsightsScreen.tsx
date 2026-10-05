import { useMemo, useState } from 'react'
import { useJournalData } from '../journalData'
import { BarList, HourOfDayChart, WeeklyIntensityChart } from '../components/charts'
import { formatRating } from '../format'
import {
  buildWeeklyIntensitySeries,
  countEntriesByHourOfDay,
  countTagFrequency,
  filterEntriesToRange,
  measureTechniqueShifts,
  summarizeEntries,
  type InsightRange,
} from '../../shared/metrics'
import type { TagKind } from '../../shared/model'

const RANGE_OPTIONS: { value: InsightRange; label: string }[] = [
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: 'Year' },
  { value: 'all', label: 'All' },
]

export function InsightsScreen() {
  const { entries, tags, isLoading } = useJournalData()
  const [selectedRange, setSelectedRange] = useState<InsightRange>(90)

  const insights = useMemo(() => {
    const now = new Date()
    const entriesInRange = filterEntriesToRange(entries, selectedRange, now)
    const frequencyItems = (tagKind: TagKind) =>
      countTagFrequency(entriesInRange, tags, tagKind).map((frequency) => ({
        key: frequency.tagId,
        label: frequency.tagName,
        value: frequency.count,
        valueText: String(frequency.count),
      }))
    return {
      summary: summarizeEntries(entriesInRange),
      weeklyPoints: buildWeeklyIntensitySeries(entriesInRange, selectedRange, now),
      topEmotions: frequencyItems('emotion'),
      topPatterns: frequencyItems('pattern'),
      topSensations: frequencyItems('sensation'),
      topContexts: frequencyItems('context'),
      techniqueShifts: measureTechniqueShifts(entriesInRange, tags).map((techniqueShift) => ({
        key: techniqueShift.tagId,
        label: techniqueShift.tagName,
        value: techniqueShift.averageDrop,
        valueText:
          techniqueShift.averageDrop >= 0
            ? `−${formatRating(techniqueShift.averageDrop)}`
            : `+${formatRating(-techniqueShift.averageDrop)}`,
      })),
      countsByHour: countEntriesByHourOfDay(entriesInRange),
    }
  }, [entries, tags, selectedRange])

  if (isLoading) return <p className="screen-message">Opening your journal…</p>

  const { summary } = insights

  return (
    <div className="screen insights">
      <header className="screen-header screen-header-with-action">
        <h1>Insights</h1>
        <a className="button button-secondary button-small" href="#/report">
          Make a report
        </a>
      </header>
      <div className="segmented" role="radiogroup" aria-label="Time range">
        {RANGE_OPTIONS.map((rangeOption) => (
          <button
            key={String(rangeOption.value)}
            type="button"
            role="radio"
            aria-checked={selectedRange === rangeOption.value}
            onClick={() => setSelectedRange(rangeOption.value)}
          >
            {rangeOption.label}
          </button>
        ))}
      </div>

      {summary.entryCount === 0 ? (
        <p className="screen-message">No records in this range yet. Patterns show up here after a few entries.</p>
      ) : (
        <>
          <dl className="stat-row">
            <div className="stat">
              <dt>Records</dt>
              <dd>{summary.entryCount}</dd>
            </div>
            <div className="stat">
              <dt>Strongest feeling, average</dt>
              <dd>{formatRating(summary.averageStartingIntensity)}</dd>
            </div>
            <div className="stat">
              <dt>Drop after working through it</dt>
              <dd>{summary.averageDrop === null ? '–' : formatRating(summary.averageDrop)}</dd>
            </div>
            <div className="stat">
              <dt>Drafts to finish</dt>
              <dd>{summary.draftCount}</dd>
            </div>
          </dl>

          <section className="insight-panel insight-wide">
            <h2>How strong it felt, week by week</h2>
            <p className="insight-note">Weekly average of the strongest feeling in each record, 0–100.</p>
            <WeeklyIntensityChart weeklyPoints={insights.weeklyPoints} />
          </section>

          <section className="insight-panel">
            <h2>Responses that helped most</h2>
            <p className="insight-note">Average change in re-rated feelings when you used each one. Shown after two or more uses.</p>
            <BarList
              items={insights.techniqueShifts}
              maximumValue={100}
              emptyText="Re-rate your feelings at the end of a record to see which responses help."
            />
          </section>

          <section className="insight-panel">
            <h2>Feelings</h2>
            <BarList items={insights.topEmotions} emptyText="No feelings logged in this range." />
          </section>

          <section className="insight-panel">
            <h2>Thinking patterns</h2>
            <BarList items={insights.topPatterns} emptyText="No thinking patterns tagged in this range." />
          </section>

          <section className="insight-panel">
            <h2>Body sensations</h2>
            <BarList items={insights.topSensations} emptyText="No body sensations tagged in this range." />
          </section>

          <section className="insight-panel">
            <h2>Contexts</h2>
            <BarList items={insights.topContexts} emptyText="No contexts tagged in this range." />
          </section>

          <section className="insight-panel">
            <h2>Time of day</h2>
            <HourOfDayChart countsByHour={insights.countsByHour} />
          </section>
        </>
      )}
    </div>
  )
}

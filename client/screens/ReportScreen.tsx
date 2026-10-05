import { useMemo, useState } from 'react'
import { api } from '../api'
import { useJournalData } from '../journalData'
import { formatFullTimestamp, formatRating, formatShortDate } from '../format'
import {
  buildWeeklyIntensitySeriesBetween,
  countTagFrequency,
  filterEntriesBetweenLocalDates,
  measureTechniqueShifts,
  strongestEndingIntensity,
  summarizeEntries,
  type WeeklyIntensityPoint,
} from '../../shared/metrics'
import { buildGuavaCsv } from '../../shared/guavaExport'
import type { Entry, Tag, TagKind } from '../../shared/model'

/**
 * A report for sharing with a clinician. It is assembled entirely in the
 * browser from records you can already see, then printed or saved as a PDF
 * by the browser itself. Nothing about its contents is sent to the server;
 * the server only logs that a report was made.
 */

function toLocalDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseLocalDateValue(localDate: string): Date {
  const [year, month, day] = localDate.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

const rangeFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const preparedFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' })

const QUICK_RANGES = [
  { label: 'Last 2 weeks', days: 14 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
] as const

export function ReportScreen() {
  const { entries, tags, tagById, isLoading } = useJournalData()
  const now = new Date()
  const [fromLocalDate, setFromLocalDate] = useState(() => toLocalDateValue(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)))
  const [toLocalDate, setToLocalDate] = useState(() => toLocalDateValue(now))
  const [nameOnReport, setNameOnReport] = useState('')
  const [includeSummary, setIncludeSummary] = useState(true)
  const [includeRecords, setIncludeRecords] = useState(true)
  const [includeWrittenText, setIncludeWrittenText] = useState(true)
  const [includeDrafts, setIncludeDrafts] = useState(false)
  const [excludedEntryIds, setExcludedEntryIds] = useState<Set<string>>(() => new Set())

  const isRangeValid = fromLocalDate !== '' && toLocalDate !== '' && fromLocalDate <= toLocalDate

  const entriesInDateRange = useMemo(
    () =>
      isRangeValid
        ? filterEntriesBetweenLocalDates(entries, fromLocalDate, toLocalDate).filter(
            (entry) => includeDrafts || entry.status === 'complete',
          )
        : [],
    [entries, fromLocalDate, toLocalDate, includeDrafts, isRangeValid],
  )
  const reportEntries = entriesInDateRange.filter((entry) => !excludedEntryIds.has(entry.id))

  const setQuickRange = (dayCount: number) => {
    const today = new Date()
    setFromLocalDate(toLocalDateValue(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (dayCount - 1))))
    setToLocalDate(toLocalDateValue(today))
  }

  const toggleEntry = (entryId: string) =>
    setExcludedEntryIds((previous) => {
      const next = new Set(previous)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })

  const printReport = () => {
    void api.recordClientExport('report').catch(() => undefined)
    // Browsers use the document title as the suggested PDF file name.
    const previousTitle = document.title
    document.title = `Thought records ${fromLocalDate} to ${toLocalDate}`
    const restoreTitle = () => {
      document.title = previousTitle
      window.removeEventListener('afterprint', restoreTitle)
    }
    window.addEventListener('afterprint', restoreTitle)
    window.print()
  }

  const downloadGuavaCsv = () => {
    void api.recordClientExport('guava_csv').catch(() => undefined)
    const csvText = buildGuavaCsv(reportEntries, tagById, { includeWrittenText })
    // Built in the browser and handed straight to the download: the plaintext never goes back to the server.
    const blobUrl = URL.createObjectURL(new Blob([csvText], { type: 'text/csv;charset=utf-8' }))
    const downloadLink = document.createElement('a')
    downloadLink.href = blobUrl
    downloadLink.download = `reframe-for-guava-${fromLocalDate}-to-${toLocalDate}.csv`
    document.body.append(downloadLink)
    downloadLink.click()
    downloadLink.remove()
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)
  }

  if (isLoading) return <p className="screen-message">Opening your journal…</p>

  const canPrint = isRangeValid && reportEntries.length > 0 && (includeSummary || includeRecords)

  return (
    <div className="screen report-screen">
      <div className="report-controls">
        <header className="screen-header">
          <a className="button button-quiet back-link" href="#/insights">
            Insights
          </a>
          <h1>Reports and exports</h1>
          <p className="screen-subtitle">
            Choose what to share, then print it or save it as a PDF to send. The PDF is not encrypted, so send it the
            way you would send any health information.
          </p>
        </header>

        <section className="report-options" aria-labelledby="report-range-heading">
          <h2 id="report-range-heading">Dates</h2>
          <div className="chip-row">
            {QUICK_RANGES.map((quickRange) => (
              <button key={quickRange.days} type="button" className="chip" onClick={() => setQuickRange(quickRange.days)}>
                {quickRange.label}
              </button>
            ))}
          </div>
          <div className="date-pair">
            <label className="field">
              <span className="field-label">From</span>
              <input type="date" value={fromLocalDate} max={toLocalDate} onChange={(event) => setFromLocalDate(event.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">To</span>
              <input type="date" value={toLocalDate} min={fromLocalDate} onChange={(event) => setToLocalDate(event.target.value)} />
            </label>
          </div>
          {!isRangeValid && (
            <p className="form-error" role="alert">
              Pick a start date on or before the end date.
            </p>
          )}
        </section>

        <section className="report-options" aria-labelledby="report-content-heading">
          <h2 id="report-content-heading">What to include</h2>
          <label className="checkbox-field">
            <input type="checkbox" checked={includeSummary} onChange={(event) => setIncludeSummary(event.target.checked)} />
            <span>Summary: averages, weekly trend, most common tags</span>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={includeRecords} onChange={(event) => setIncludeRecords(event.target.checked)} />
            <span>Each record in full</span>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={includeWrittenText} onChange={(event) => setIncludeWrittenText(event.target.checked)} />
            <span>What I wrote (off: ratings and tags only)</span>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={includeDrafts} onChange={(event) => setIncludeDrafts(event.target.checked)} />
            <span>Unfinished drafts</span>
          </label>
          <label className="field">
            <span className="field-label">Name on the report (optional, not saved)</span>
            <input value={nameOnReport} maxLength={80} onChange={(event) => setNameOnReport(event.target.value)} autoComplete="off" />
          </label>
        </section>

        {entriesInDateRange.length > 0 && (
          <details className="report-options report-picker">
            <summary>
              Records included: {reportEntries.length} of {entriesInDateRange.length}
            </summary>
            <p className="field-hint">Untick any record you would rather keep to yourself. The summary updates to match.</p>
            <ul className="report-picker-list">
              {entriesInDateRange.map((entry) => (
                <li key={entry.id}>
                  <label className="checkbox-field">
                    <input type="checkbox" checked={!excludedEntryIds.has(entry.id)} onChange={() => toggleEntry(entry.id)} />
                    <span>
                      <span className="report-picker-when">{formatFullTimestamp(entry.occurredAt)}</span>
                      <span className="report-picker-text">{entry.situation.trim().split('\n')[0] || 'No situation written'}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="report-actions">
          <div className="button-row">
            <button type="button" className="button button-primary" disabled={!canPrint} onClick={printReport}>
              Print or save as PDF
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={!isRangeValid || reportEntries.length === 0}
              onClick={downloadGuavaCsv}
            >
              Download CSV for Guava
            </button>
          </div>
          <p className="field-hint">
            {canPrint
              ? 'On iPhone, choose Print, then Share to save or send the PDF. In Guava, import the CSV under Data Sources › Data Imports, or upload the PDF under Data Sources › File Uploads.'
              : isRangeValid && reportEntries.length === 0
                ? 'No records in these dates yet.'
                : 'Choose at least one section to include.'}
          </p>
        </div>

        <h2 className="report-preview-heading">Preview</h2>
      </div>

      {isRangeValid && reportEntries.length > 0 && (includeSummary || includeRecords) && (
        <ReportDocument
          reportEntries={reportEntries}
          tags={tags}
          tagById={tagById}
          fromDate={parseLocalDateValue(fromLocalDate)}
          toDate={parseLocalDateValue(toLocalDate)}
          nameOnReport={nameOnReport.trim()}
          includeSummary={includeSummary}
          includeRecords={includeRecords}
          includeWrittenText={includeWrittenText}
        />
      )}
    </div>
  )
}

interface ReportDocumentProps {
  reportEntries: Entry[]
  tags: Tag[]
  tagById: Map<string, Tag>
  fromDate: Date
  toDate: Date
  nameOnReport: string
  includeSummary: boolean
  includeRecords: boolean
  includeWrittenText: boolean
}

function ReportDocument(props: ReportDocumentProps) {
  const { reportEntries, tags, tagById, fromDate, toDate, nameOnReport, includeSummary, includeRecords, includeWrittenText } = props
  const summary = summarizeEntries(reportEntries)
  const endingIntensities = reportEntries.map(strongestEndingIntensity).filter((value): value is number => value !== null)
  const averageEndingIntensity =
    endingIntensities.length === 0 ? null : endingIntensities.reduce((sum, value) => sum + value, 0) / endingIntensities.length
  const weeklyPoints = buildWeeklyIntensitySeriesBetween(reportEntries, fromDate, toDate)
  const frequencyRows = (tagKind: TagKind) => countTagFrequency(reportEntries, tags, tagKind, 6)
  const techniqueShifts = measureTechniqueShifts(reportEntries, tags)
  const recordCountText = `${reportEntries.length} ${reportEntries.length === 1 ? 'record' : 'records'}`

  return (
    <article className="report-paper" aria-label="Report preview">
      <header className="report-header">
        <h1 className="report-title">Thought records</h1>
        {nameOnReport && <p className="report-name">{nameOnReport}</p>}
        <p className="report-meta">
          {rangeFormatter.formatRange(fromDate, toDate)}, {recordCountText}. Prepared {preparedFormatter.format(new Date())}.
        </p>
        <p className="report-meta">
          Feelings are self-rated from 0 (not at all) to 100 (the most intense), at the time and again after working
          through the record.
          {includeRecords && !includeWrittenText && ' Written notes are not included in this copy.'}
        </p>
      </header>

      {includeSummary && (
        <section className="report-section">
          <h2>Summary</h2>
          <dl className="report-stats">
            <div>
              <dt>Records</dt>
              <dd>{reportEntries.length}</dd>
            </div>
            <div>
              <dt>Strongest feeling at the time, average</dt>
              <dd>{formatRating(summary.averageStartingIntensity)}</dd>
            </div>
            <div>
              <dt>Strongest feeling after, average</dt>
              <dd>{formatRating(averageEndingIntensity)}</dd>
            </div>
            <div>
              <dt>Average drop per re-rated feeling</dt>
              <dd>{formatRating(summary.averageDrop)}</dd>
            </div>
          </dl>

          {weeklyPoints.length >= 2 && (
            <figure className="report-figure">
              <figcaption>Weekly average of the strongest feeling in each record</figcaption>
              <ReportTrendChart weeklyPoints={weeklyPoints} />
            </figure>
          )}

          <div className="report-table-grid">
            <FrequencyTable title="Feelings" rows={frequencyRows('emotion')} />
            <FrequencyTable title="Thinking patterns" rows={frequencyRows('pattern')} />
            <FrequencyTable title="Body sensations" rows={frequencyRows('sensation')} />
            <FrequencyTable title="Contexts" rows={frequencyRows('context')} />
          </div>

          {techniqueShifts.length > 0 && (
            <table className="report-table">
              <caption>Responses and the average change in re-rated feelings (used two or more times)</caption>
              <thead>
                <tr>
                  <th scope="col">Response</th>
                  <th scope="col">Times used</th>
                  <th scope="col">Average change</th>
                </tr>
              </thead>
              <tbody>
                {techniqueShifts.map((techniqueShift) => (
                  <tr key={techniqueShift.tagId}>
                    <th scope="row">{techniqueShift.tagName}</th>
                    <td>{techniqueShift.entryCount}</td>
                    <td>
                      {techniqueShift.averageDrop >= 0
                        ? `−${formatRating(techniqueShift.averageDrop)}`
                        : `+${formatRating(-techniqueShift.averageDrop)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {includeRecords && (
        <section className="report-section report-records">
          <h2>Records</h2>
          {reportEntries.map((entry) => (
            <ReportRecord key={entry.id} entry={entry} tagById={tagById} includeWrittenText={includeWrittenText} />
          ))}
        </section>
      )}

      <footer className="report-footer">Exported from a personal journal. Contains private health information.</footer>
    </article>
  )
}

function FrequencyTable({ title, rows }: { title: string; rows: { tagId: string; tagName: string; count: number }[] }) {
  return (
    <table className="report-table">
      <caption>{title}</caption>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="report-empty">None tagged</td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.tagId}>
              <th scope="row">{row.tagName}</th>
              <td>{row.count}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

function ReportRecord({ entry, tagById, includeWrittenText }: { entry: Entry; tagById: Map<string, Tag>; includeWrittenText: boolean }) {
  const tagNames = (tagIds: string[]) => tagIds.map((tagId) => tagById.get(tagId)?.name ?? 'Deleted tag').join(', ')
  const section = (title: string, tagIds: string[], writtenText: string) => {
    const tagText = tagNames(tagIds)
    const shownText = includeWrittenText ? writtenText.trim() : ''
    return (
      <div className="report-record-part">
        <dt>{title}</dt>
        <dd>
          {tagText && <span className="report-record-tags">{tagText}</span>}
          {shownText && <span className="report-record-text">{shownText}</span>}
          {!tagText && !shownText && <span className="report-empty">—</span>}
        </dd>
      </div>
    )
  }

  return (
    <article className="report-record">
      <h3>
        {formatFullTimestamp(entry.occurredAt)}
        {entry.status === 'draft' && <span className="report-draft"> (unfinished)</span>}
      </h3>
      <dl className="report-record-grid">
        {section('Situation', entry.contextTagIds, entry.situation)}
        <div className="report-record-part">
          <dt>Feelings (at the time → after)</dt>
          <dd>
            {entry.emotions.length === 0 ? (
              <span className="report-empty">—</span>
            ) : (
              <span className="report-record-tags">
                {entry.emotions
                  .map(
                    (emotionRating) =>
                      `${tagById.get(emotionRating.tagId)?.name ?? 'Deleted tag'} ${emotionRating.intensityBefore}` +
                      (emotionRating.intensityAfter === null ? '' : ` → ${emotionRating.intensityAfter}`),
                  )
                  .join(', ')}
              </span>
            )}
          </dd>
        </div>
        {section('Body', entry.sensationTagIds, entry.bodyNotes)}
        {section('Thoughts', entry.patternTagIds, entry.thoughts)}
        {includeWrittenText && section('Balanced view', [], entry.alternativeThought)}
        {section('Response', entry.techniqueTagIds, entry.response)}
      </dl>
    </article>
  )
}

/** Static version of the weekly chart: fixed viewBox so it scales cleanly onto paper. */
function ReportTrendChart({ weeklyPoints }: { weeklyPoints: WeeklyIntensityPoint[] }) {
  const chartWidth = 640
  const chartHeight = 190
  const margin = { top: 12, right: 36, bottom: 24, left: 30 }
  const plotWidth = chartWidth - margin.left - margin.right
  const plotHeight = chartHeight - margin.top - margin.bottom
  const xForIndex = (pointIndex: number) => margin.left + (pointIndex / Math.max(1, weeklyPoints.length - 1)) * plotWidth
  const yForValue = (intensityValue: number) => margin.top + plotHeight - (intensityValue / 100) * plotHeight
  const tickStride = Math.max(1, Math.ceil(weeklyPoints.length / 8))

  const series = [
    { key: 'before', label: 'At the time', valueOf: (point: WeeklyIntensityPoint) => point.averageStartingIntensity },
    { key: 'after', label: 'After', valueOf: (point: WeeklyIntensityPoint) => point.averageEndingIntensity },
  ] as const

  return (
    <>
      <div className="chart-legend">
        {series.map((seriesDefinition) => (
          <span key={seriesDefinition.key} className={`legend-item legend-${seriesDefinition.key}`}>
            <span className="legend-swatch" aria-hidden="true" />
            {seriesDefinition.label}
          </span>
        ))}
      </div>
      <svg
        className="report-chart"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        role="img"
        aria-label="Weekly average of the strongest feeling, at the time and after, 0 to 100"
      >
        {[0, 50, 100].map((gridValue) => (
          <g key={gridValue}>
            <line className="chart-grid" x1={margin.left} x2={margin.left + plotWidth} y1={yForValue(gridValue)} y2={yForValue(gridValue)} />
            <text className="chart-axis-label" x={margin.left - 8} y={yForValue(gridValue) + 4} textAnchor="end">
              {gridValue}
            </text>
          </g>
        ))}
        {weeklyPoints.map((point, pointIndex) =>
          pointIndex % tickStride === 0 ? (
            <text key={pointIndex} className="chart-axis-label" x={xForIndex(pointIndex)} y={chartHeight - 4} textAnchor="middle">
              {formatShortDate(point.weekStart)}
            </text>
          ) : null,
        )}
        {series.map((seriesDefinition) => {
          let pathData = ''
          let isPenDown = false
          let lastIndexWithValue = -1
          weeklyPoints.forEach((point, pointIndex) => {
            const pointValue = seriesDefinition.valueOf(point)
            if (pointValue === null) {
              isPenDown = false
              return
            }
            pathData += `${isPenDown ? 'L' : 'M'}${xForIndex(pointIndex).toFixed(1)},${yForValue(pointValue).toFixed(1)}`
            isPenDown = true
            lastIndexWithValue = pointIndex
          })
          return (
            <g key={seriesDefinition.key} className={`series series-${seriesDefinition.key}`}>
              <path className="series-line" d={pathData} />
              {weeklyPoints.map((point, pointIndex) => {
                const pointValue = seriesDefinition.valueOf(point)
                return pointValue === null ? null : (
                  <circle key={pointIndex} className="series-marker" cx={xForIndex(pointIndex)} cy={yForValue(pointValue)} r={4} />
                )
              })}
              {lastIndexWithValue >= 0 && (
                <text
                  className="series-end-label"
                  x={xForIndex(lastIndexWithValue) + 8}
                  y={yForValue(seriesDefinition.valueOf(weeklyPoints[lastIndexWithValue]!)!) + 4}
                >
                  {formatRating(seriesDefinition.valueOf(weeklyPoints[lastIndexWithValue]!))}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </>
  )
}

import { useMemo, useState } from 'react'
import { useJournalData } from '../journalData'
import { formatDayHeading, formatTime } from '../format'
import { strongestEndingIntensity, strongestStartingIntensity, tagIdsOfKind } from '../../shared/metrics'
import { TAG_KINDS, type Entry } from '../../shared/model'

export function EntriesScreen() {
  const { entries, tagById, isLoading, loadError } = useJournalData()
  const [searchText, setSearchText] = useState('')
  const [filterTagId, setFilterTagId] = useState<string | null>(null)
  const [showDraftsOnly, setShowDraftsOnly] = useState(false)

  const filteredEntries = useMemo(() => {
    const normalizedSearch = searchText.trim().toLocaleLowerCase()
    return entries.filter((entry) => {
      if (showDraftsOnly && entry.status !== 'draft') return false
      if (filterTagId && !TAG_KINDS.some((tagKind) => tagIdsOfKind(entry, tagKind).includes(filterTagId))) return false
      if (!normalizedSearch) return true
      const searchableText = [entry.situation, entry.thoughts, entry.alternativeThought, entry.response, entry.bodyNotes]
        .join(' ')
        .toLocaleLowerCase()
      const tagNames = TAG_KINDS.flatMap((tagKind) => tagIdsOfKind(entry, tagKind))
        .map((tagId) => tagById.get(tagId)?.name.toLocaleLowerCase() ?? '')
        .join(' ')
      return searchableText.includes(normalizedSearch) || tagNames.includes(normalizedSearch)
    })
  }, [entries, searchText, filterTagId, showDraftsOnly, tagById])

  const entriesGroupedByDay = useMemo(() => {
    const groups: { dayKey: string; heading: string; dayEntries: Entry[] }[] = []
    for (const entry of filteredEntries) {
      const occurredAt = new Date(entry.occurredAt)
      const dayKey = occurredAt.toDateString()
      const lastGroup = groups.at(-1)
      if (lastGroup?.dayKey === dayKey) lastGroup.dayEntries.push(entry)
      else groups.push({ dayKey, heading: formatDayHeading(occurredAt), dayEntries: [entry] })
    }
    return groups
  }, [filteredEntries])

  const draftCount = entries.filter((entry) => entry.status === 'draft').length

  if (isLoading) return <p className="screen-message">Opening your journal…</p>
  if (loadError) return <p className="screen-message form-error">{loadError}</p>

  if (entries.length === 0) {
    return (
      <div className="screen empty-state">
        <h1>No records yet</h1>
        <p>When a feeling shows up, log the moment. You can save a draft with just the situation and finish it later.</p>
        <a className="button button-primary" href="#/log">
          Log a moment
        </a>
      </div>
    )
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Records</h1>
      </header>

      <div className="filter-bar">
        <input
          type="search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search words or tags"
          aria-label="Search records"
        />
        <div className="filter-chips">
          {draftCount > 0 && (
            <button type="button" className="chip" aria-pressed={showDraftsOnly} onClick={() => setShowDraftsOnly(!showDraftsOnly)}>
              Drafts ({draftCount})
            </button>
          )}
          {filterTagId && (
            <button type="button" className="chip" aria-pressed="true" onClick={() => setFilterTagId(null)}>
              {tagById.get(filterTagId)?.name ?? 'Tag'} ×
            </button>
          )}
        </div>
      </div>

      {entriesGroupedByDay.length === 0 && <p className="screen-message">Nothing matches. Clear the search or filters to see every record.</p>}

      {entriesGroupedByDay.map((dayGroup) => (
        <section key={dayGroup.dayKey} className="day-group" aria-label={dayGroup.heading}>
          <h2 className="day-heading">{dayGroup.heading}</h2>
          <ul className="entry-list">
            {dayGroup.dayEntries.map((entry) => (
              <li key={entry.id}>
                <EntryCard entry={entry} onTagFilter={setFilterTagId} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function EntryCard({ entry, onTagFilter }: { entry: Entry; onTagFilter: (tagId: string) => void }) {
  const { tagById } = useJournalData()
  const startingIntensity = strongestStartingIntensity(entry)
  const endingIntensity = strongestEndingIntensity(entry)
  const firstLine = entry.situation.trim().split('\n')[0] || 'No situation written yet'

  return (
    <article className="entry-card">
      <a className="entry-card-link" href={`#/entries/${entry.id}`}>
        <span className="entry-card-time">
          {formatTime(entry.occurredAt)}
          {entry.status === 'draft' && <span className="badge-draft">Draft</span>}
        </span>
        <span className="entry-card-situation">{firstLine}</span>
        {startingIntensity !== null && (
          <span
            className="shift-bar"
            aria-label={
              endingIntensity === null
                ? `Strongest feeling ${startingIntensity}`
                : `Strongest feeling ${startingIntensity}, then ${endingIntensity}`
            }
          >
            <ShiftBar startingIntensity={startingIntensity} endingIntensity={endingIntensity} />
          </span>
        )}
      </a>
      {entry.emotions.length > 0 && (
        <div className="entry-card-tags">
          {entry.emotions.map((emotionRating) => (
            <button key={emotionRating.tagId} type="button" className="mini-chip" onClick={() => onTagFilter(emotionRating.tagId)}>
              {tagById.get(emotionRating.tagId)?.name ?? 'Feeling'}
            </button>
          ))}
        </div>
      )}
    </article>
  )
}

/** Two stacked strips: how strong it was, and (if re-rated) how strong it was after. */
function ShiftBar({ startingIntensity, endingIntensity }: { startingIntensity: number; endingIntensity: number | null }) {
  return (
    <svg className="shift-bar-svg" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
      <rect className="shift-bar-rail" x="0" y="0" width="100" height="4" rx="2" />
      <rect className="shift-bar-before" x="0" y="0" width={Math.max(startingIntensity, 2)} height="4" rx="2" />
      {endingIntensity !== null && (
        <>
          <rect className="shift-bar-rail" x="0" y="6" width="100" height="4" rx="2" />
          <rect className="shift-bar-after" x="0" y="6" width={Math.max(endingIntensity, 2)} height="4" rx="2" />
        </>
      )}
    </svg>
  )
}

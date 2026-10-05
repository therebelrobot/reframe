import { useState, type ReactNode } from 'react'
import { api, ApiError } from '../api'
import { useJournalData } from '../journalData'
import { navigateTo } from '../router'
import { formatFullTimestamp } from '../format'
import type { Entry } from '../../shared/model'

export function EntryDetailScreen({ entry }: { entry: Entry }) {
  const { tagById, refresh } = useJournalData()
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const tagNames = (tagIds: string[]) => tagIds.map((tagId) => tagById.get(tagId)?.name ?? 'Deleted tag')

  const deleteEntry = async () => {
    if (!window.confirm('Delete this record? This cannot be undone.')) return
    try {
      await api.deleteEntry(entry.id)
      await refresh()
      navigateTo('/entries', { replace: true })
    } catch (error) {
      setDeleteError(error instanceof ApiError ? error.message : 'Could not delete the record.')
    }
  }

  return (
    <article className="screen detail">
      <header className="detail-header">
        <a className="button button-quiet back-link" href="#/entries">
          Records
        </a>
        <a className="button button-secondary" href={`#/entries/${entry.id}/edit`}>
          {entry.status === 'draft' ? 'Continue' : 'Edit'}
        </a>
      </header>
      <p className="detail-when">
        {formatFullTimestamp(entry.occurredAt)}
        {entry.status === 'draft' && <span className="badge-draft">Draft</span>}
      </p>

      <DetailSection title="Situation" tagNames={tagNames(entry.contextTagIds)} text={entry.situation} />

      <section className="detail-section">
        <h2>Feelings</h2>
        {entry.emotions.length === 0 ? (
          <p className="detail-empty">Not filled in</p>
        ) : (
          <table className="rating-table">
            <thead>
              <tr>
                <th scope="col">Feeling</th>
                <th scope="col">At the time</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {entry.emotions.map((emotionRating) => (
                <tr key={emotionRating.tagId}>
                  <th scope="row">{tagById.get(emotionRating.tagId)?.name ?? 'Deleted tag'}</th>
                  <td className="rating-before">{emotionRating.intensityBefore}</td>
                  <td className="rating-after">{emotionRating.intensityAfter ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <DetailSection title="Body" tagNames={tagNames(entry.sensationTagIds)} text={entry.bodyNotes} />
      <DetailSection title="Thoughts" tagNames={tagNames(entry.patternTagIds)} text={entry.thoughts} />
      <DetailSection title="Balanced view" text={entry.alternativeThought} />
      <DetailSection title="Response" tagNames={tagNames(entry.techniqueTagIds)} text={entry.response} />

      <footer className="detail-footer">
        <button type="button" className="button button-danger" onClick={() => void deleteEntry()}>
          Delete record
        </button>
        {deleteError && (
          <p className="form-error" role="alert">
            {deleteError}
          </p>
        )}
      </footer>
    </article>
  )
}

function DetailSection({ title, text, tagNames = [] }: { title: string; text: string; tagNames?: string[] }): ReactNode {
  const isEmpty = !text.trim() && tagNames.length === 0
  return (
    <section className="detail-section">
      <h2>{title}</h2>
      {isEmpty && <p className="detail-empty">Not filled in</p>}
      {tagNames.length > 0 && (
        <ul className="detail-tags">
          {tagNames.map((tagName) => (
            <li key={tagName} className="mini-chip">
              {tagName}
            </li>
          ))}
        </ul>
      )}
      {text.trim() && <p className="detail-text">{text}</p>}
    </section>
  )
}

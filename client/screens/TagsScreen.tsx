import { useState, type FormEvent } from 'react'
import { api, ApiError, type TagWithUsage } from '../api'
import { useJournalData } from '../journalData'
import { TAG_KINDS, TAG_KIND_LABELS, type TagKind } from '../../shared/model'

export function TagsScreen() {
  const { tags } = useJournalData()
  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Tags</h1>
        <p className="screen-subtitle">Tags you reuse across records. Archive one to hide it from pickers without changing old records.</p>
      </header>
      {TAG_KINDS.map((tagKind) => (
        <TagKindSection key={tagKind} tagKind={tagKind} kindTags={tags.filter((tag) => tag.kind === tagKind)} />
      ))}
    </div>
  )
}

function TagKindSection({ tagKind, kindTags }: { tagKind: TagKind; kindTags: TagWithUsage[] }) {
  const { refresh } = useJournalData()
  const [newTagName, setNewTagName] = useState('')
  const [sectionError, setSectionError] = useState<string | null>(null)
  const activeTags = kindTags.filter((tag) => !tag.archived)
  const archivedTags = kindTags.filter((tag) => tag.archived)

  const runTagChange = async (tagChange: () => Promise<unknown>) => {
    try {
      await tagChange()
      await refresh()
      setSectionError(null)
    } catch (error) {
      setSectionError(error instanceof ApiError ? error.message : 'Could not update that tag.')
    }
  }

  const addTag = (event: FormEvent) => {
    event.preventDefault()
    const trimmedName = newTagName.trim()
    if (!trimmedName) return
    void runTagChange(async () => {
      await api.createTag({ kind: tagKind, name: trimmedName, archived: false })
      setNewTagName('')
    })
  }

  return (
    <section className="tag-section" aria-labelledby={`tag-section-${tagKind}`}>
      <h2 id={`tag-section-${tagKind}`}>{TAG_KIND_LABELS[tagKind].plural}</h2>
      <ul className="tag-rows">
        {activeTags.map((tag) => (
          <TagRow key={tag.id} tag={tag} onChange={runTagChange} />
        ))}
      </ul>
      <form className="inline-add" onSubmit={addTag}>
        <input
          value={newTagName}
          maxLength={60}
          onChange={(event) => setNewTagName(event.target.value)}
          placeholder={`Add a ${TAG_KIND_LABELS[tagKind].singular.toLowerCase()}`}
          aria-label={`New ${TAG_KIND_LABELS[tagKind].singular.toLowerCase()}`}
        />
        <button type="submit" className="button button-small">
          Add
        </button>
      </form>
      {archivedTags.length > 0 && (
        <details className="archived-tags">
          <summary>Archived ({archivedTags.length})</summary>
          <ul className="tag-rows">
            {archivedTags.map((tag) => (
              <TagRow key={tag.id} tag={tag} onChange={runTagChange} />
            ))}
          </ul>
        </details>
      )}
      {sectionError && (
        <p className="form-error" role="alert">
          {sectionError}
        </p>
      )}
    </section>
  )
}

function TagRow({ tag, onChange }: { tag: TagWithUsage; onChange: (tagChange: () => Promise<unknown>) => Promise<void> }) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [draftName, setDraftName] = useState(tag.name)

  const saveRename = (event: FormEvent) => {
    event.preventDefault()
    void onChange(() => api.replaceTag(tag.id, { kind: tag.kind, name: draftName.trim(), archived: tag.archived })).then(() =>
      setIsRenaming(false),
    )
  }

  if (isRenaming) {
    return (
      <li className="tag-row">
        <form className="inline-add" onSubmit={saveRename}>
          <input autoFocus value={draftName} maxLength={60} onChange={(event) => setDraftName(event.target.value)} aria-label="Tag name" />
          <button type="submit" className="button button-small">
            Save
          </button>
          <button
            type="button"
            className="button button-small button-quiet"
            onClick={() => {
              setDraftName(tag.name)
              setIsRenaming(false)
            }}
          >
            Cancel
          </button>
        </form>
      </li>
    )
  }

  return (
    <li className="tag-row">
      <span className="tag-row-name">{tag.name}</span>
      <span className="tag-row-usage">{tag.usageCount === 1 ? '1 record' : `${tag.usageCount} records`}</span>
      <span className="tag-row-actions">
        <button type="button" className="button button-small button-quiet" onClick={() => setIsRenaming(true)}>
          Rename
        </button>
        <button
          type="button"
          className="button button-small button-quiet"
          onClick={() => void onChange(() => api.replaceTag(tag.id, { kind: tag.kind, name: tag.name, archived: !tag.archived }))}
        >
          {tag.archived ? 'Restore' : 'Archive'}
        </button>
        {tag.usageCount === 0 && (
          <button
            type="button"
            className="button button-small button-quiet button-danger-text"
            onClick={() => {
              if (window.confirm(`Delete "${tag.name}"?`)) void onChange(() => api.deleteTag(tag.id))
            }}
          >
            Delete
          </button>
        )}
      </span>
    </li>
  )
}

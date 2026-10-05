import { useId, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { useJournalData } from '../journalData'
import { TAG_KIND_LABELS, type TagKind } from '../../shared/model'

interface TagPickerProps {
  tagKind: TagKind
  selectedTagIds: string[]
  onChange: (selectedTagIds: string[]) => void
  label?: string
}

/** Toggle chips for one kind of tag, with inline creation so a new tag never means leaving the record. */
export function TagPicker({ tagKind, selectedTagIds, onChange, label }: TagPickerProps) {
  const { tags, refresh } = useJournalData()
  const [isAdding, setIsAdding] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const groupLabelId = useId()

  const visibleTags = tags
    .filter((tag) => tag.kind === tagKind && (!tag.archived || selectedTagIds.includes(tag.id)))
    // Most-used first: the chips you reach for most sit where your thumb lands.
    .sort((left, right) => right.usageCount - left.usageCount || left.name.localeCompare(right.name))

  const toggleTag = (tagId: string) =>
    onChange(selectedTagIds.includes(tagId) ? selectedTagIds.filter((id) => id !== tagId) : [...selectedTagIds, tagId])

  const submitNewTag = async (event: FormEvent) => {
    event.preventDefault()
    const trimmedName = newTagName.trim()
    if (!trimmedName) return
    try {
      const createdTag = await api.createTag({ kind: tagKind, name: trimmedName, archived: false })
      await refresh()
      onChange([...selectedTagIds, createdTag.id])
      setNewTagName('')
      setIsAdding(false)
      setAddError(null)
    } catch (error) {
      setAddError(error instanceof ApiError ? error.message : 'Could not add that tag.')
    }
  }

  return (
    <div className="tag-picker">
      <p className="field-label" id={groupLabelId}>
        {label ?? TAG_KIND_LABELS[tagKind].plural}
      </p>
      <div className="chip-row" role="group" aria-labelledby={groupLabelId}>
        {visibleTags.map((tag) => {
          const isSelected = selectedTagIds.includes(tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              className={`chip chip-${tagKind}`}
              aria-pressed={isSelected}
              onClick={() => toggleTag(tag.id)}
            >
              {tag.name}
            </button>
          )
        })}
        {!isAdding && (
          <button type="button" className="chip chip-add" onClick={() => setIsAdding(true)}>
            + New
          </button>
        )}
      </div>
      {isAdding && (
        <form className="inline-add" onSubmit={submitNewTag}>
          <input
            autoFocus
            value={newTagName}
            maxLength={60}
            onChange={(event) => setNewTagName(event.target.value)}
            placeholder={`New ${TAG_KIND_LABELS[tagKind].singular.toLowerCase()}`}
            aria-label={`New ${TAG_KIND_LABELS[tagKind].singular.toLowerCase()} name`}
          />
          <button type="submit" className="button button-small">
            Add
          </button>
          <button
            type="button"
            className="button button-small button-quiet"
            onClick={() => {
              setIsAdding(false)
              setAddError(null)
            }}
          >
            Cancel
          </button>
        </form>
      )}
      {addError && (
        <p className="field-error" role="alert">
          {addError}
        </p>
      )}
    </div>
  )
}

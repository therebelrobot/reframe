import { useMemo, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from '../api'
import { useJournalData } from '../journalData'
import { navigateTo } from '../router'
import { TagPicker } from '../components/TagPicker'
import { IntensitySlider } from '../components/IntensitySlider'
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '../format'
import { createEmptyEntryInput, type Entry, type EntryInput, type EmotionRating } from '../../shared/model'

interface EntryEditorProps {
  existingEntry?: Entry
}

interface EditorStep {
  shortTitle: string
  title: string
  helperQuestions: string[]
}

// The six parts of a thought record, in the order you work through them.
const EDITOR_STEPS: EditorStep[] = [
  {
    shortTitle: 'Situation',
    title: 'What was happening?',
    helperQuestions: ['Where were you, and when?', 'Who else was there?', 'What happened just before you noticed the feeling?'],
  },
  {
    shortTitle: 'Feelings',
    title: 'What did you feel?',
    helperQuestions: ['Pick every feeling that was there, not only the loudest.', 'Rate how strong each one was at the time, 0 to 100.'],
  },
  {
    shortTitle: 'Body',
    title: 'What did your body do?',
    helperQuestions: ['What did you notice physically?', 'Could anyone else have seen it?', 'Did you want to leave, freeze, or act?'],
  },
  {
    shortTitle: 'Thoughts',
    title: 'What went through your mind?',
    helperQuestions: [
      'What were you telling yourself right then?',
      'What did it seem to say about you, or about what would happen next?',
      'What felt like the worst outcome, and what would be worst about it?',
      'Was it a fact, or a prediction?',
    ],
  },
  {
    shortTitle: 'Balance',
    title: 'Is there another way to see it?',
    helperQuestions: [
      'Pause and take one slow breath first.',
      'What would you say to a friend in exactly this spot?',
      'Were you overestimating the danger, or underestimating how you would cope?',
      'How might this look in a week?',
    ],
  },
  {
    shortTitle: 'Response',
    title: 'What did you do, and how do you feel now?',
    helperQuestions: ['What did you do, or what could you do next time?', 'What would help most: you, someone else, the situation?', 'Re-rate each feeling now.'],
  },
]

export function EntryEditor({ existingEntry }: EntryEditorProps) {
  const { refresh, tagById } = useJournalData()
  const initialEntryInput = useMemo<EntryInput>(() => {
    if (!existingEntry) return createEmptyEntryInput()
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...existingEntryInput } = existingEntry
    return existingEntryInput
  }, [existingEntry])
  const [entryInput, setEntryInput] = useState<EntryInput>(initialEntryInput)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const stepHeadingRef = useRef<HTMLHeadingElement>(null)

  const hasUnsavedChanges = JSON.stringify(entryInput) !== JSON.stringify(initialEntryInput)
  const isLastStep = currentStepIndex === EDITOR_STEPS.length - 1
  const currentStep = EDITOR_STEPS[currentStepIndex]!

  const updateEntryInput = (changes: Partial<EntryInput>) => setEntryInput((previous) => ({ ...previous, ...changes }))

  const goToStep = (stepIndex: number) => {
    setCurrentStepIndex(stepIndex)
    window.scrollTo(0, 0)
    // Move focus to the new step's heading so screen readers announce it.
    requestAnimationFrame(() => stepHeadingRef.current?.focus())
  }

  const saveEntry = async (status: EntryInput['status']) => {
    setIsSaving(true)
    setSaveError(null)
    try {
      const entryToSave = { ...entryInput, status }
      const savedEntry = existingEntry
        ? await api.replaceEntry(existingEntry.id, entryToSave)
        : await api.createEntry(entryToSave)
      await refresh()
      navigateTo(`/entries/${savedEntry.id}`, { replace: true })
    } catch (error) {
      setSaveError(error instanceof ApiError ? error.message : 'Could not save. Check your connection and try again.')
      setIsSaving(false)
    }
  }

  const closeEditor = () => {
    if (hasUnsavedChanges && !window.confirm('Discard what you have written?')) return
    if (existingEntry) navigateTo(`/entries/${existingEntry.id}`, { replace: true })
    else navigateTo('/entries', { replace: true })
  }

  // Keeps an existing complete record complete; anything else saves as a draft to finish later.
  const quickSaveStatus: EntryInput['status'] = existingEntry?.status === 'complete' ? 'complete' : 'draft'

  const selectedEmotionTagIds = entryInput.emotions.map((emotionRating) => emotionRating.tagId)

  const setSelectedEmotions = (nextSelectedTagIds: string[]) => {
    const ratingsByTagId = new Map(entryInput.emotions.map((emotionRating) => [emotionRating.tagId, emotionRating]))
    updateEntryInput({
      emotions: nextSelectedTagIds.map(
        (tagId): EmotionRating => ratingsByTagId.get(tagId) ?? { tagId, intensityBefore: 50, intensityAfter: null },
      ),
    })
  }

  const updateEmotion = (tagId: string, changes: Partial<EmotionRating>) =>
    updateEntryInput({
      emotions: entryInput.emotions.map((emotionRating) =>
        emotionRating.tagId === tagId ? { ...emotionRating, ...changes } : emotionRating,
      ),
    })

  const emotionName = (tagId: string) => tagById.get(tagId)?.name ?? 'Feeling'

  const stepBodies: ReactNode[] = [
    <>
      <label className="field">
        <span className="field-label">When</span>
        <input
          type="datetime-local"
          value={toDateTimeLocalValue(entryInput.occurredAt)}
          onChange={(event) => updateEntryInput({ occurredAt: fromDateTimeLocalValue(event.target.value) })}
        />
      </label>
      <label className="field">
        <span className="field-label">What happened</span>
        <textarea
          rows={5}
          value={entryInput.situation}
          onChange={(event) => updateEntryInput({ situation: event.target.value })}
          placeholder="A few words is enough"
        />
      </label>
      <TagPicker
        tagKind="context"
        label="Context"
        selectedTagIds={entryInput.contextTagIds}
        onChange={(contextTagIds) => updateEntryInput({ contextTagIds })}
      />
    </>,
    <>
      <TagPicker tagKind="emotion" label="Feelings" selectedTagIds={selectedEmotionTagIds} onChange={setSelectedEmotions} />
      {entryInput.emotions.length === 0 ? (
        <p className="empty-hint">Tap a feeling above to rate how strong it was.</p>
      ) : (
        <div className="slider-stack">
          {entryInput.emotions.map((emotionRating) => (
            <IntensitySlider
              key={emotionRating.tagId}
              tone="before"
              label={emotionName(emotionRating.tagId)}
              value={emotionRating.intensityBefore}
              onChange={(intensityBefore) => updateEmotion(emotionRating.tagId, { intensityBefore })}
              onRemove={() => setSelectedEmotions(selectedEmotionTagIds.filter((tagId) => tagId !== emotionRating.tagId))}
            />
          ))}
        </div>
      )}
    </>,
    <>
      <TagPicker
        tagKind="sensation"
        label="Sensations"
        selectedTagIds={entryInput.sensationTagIds}
        onChange={(sensationTagIds) => updateEntryInput({ sensationTagIds })}
      />
      <label className="field">
        <span className="field-label">Anything else you noticed</span>
        <textarea rows={3} value={entryInput.bodyNotes} onChange={(event) => updateEntryInput({ bodyNotes: event.target.value })} />
      </label>
    </>,
    <>
      <label className="field">
        <span className="field-label">Thoughts and images</span>
        <textarea rows={6} value={entryInput.thoughts} onChange={(event) => updateEntryInput({ thoughts: event.target.value })} />
      </label>
      <TagPicker
        tagKind="pattern"
        label="Thinking patterns you spot"
        selectedTagIds={entryInput.patternTagIds}
        onChange={(patternTagIds) => updateEntryInput({ patternTagIds })}
      />
    </>,
    <>
      {entryInput.thoughts.trim() && (
        <blockquote className="echo">
          <span className="echo-label">You wrote</span>
          {entryInput.thoughts}
        </blockquote>
      )}
      <label className="field">
        <span className="field-label">A more balanced thought</span>
        <textarea
          rows={6}
          value={entryInput.alternativeThought}
          onChange={(event) => updateEntryInput({ alternativeThought: event.target.value })}
        />
      </label>
    </>,
    <>
      <label className="field">
        <span className="field-label">What you did, or could do</span>
        <textarea rows={4} value={entryInput.response} onChange={(event) => updateEntryInput({ response: event.target.value })} />
      </label>
      <TagPicker
        tagKind="technique"
        label="Responses"
        selectedTagIds={entryInput.techniqueTagIds}
        onChange={(techniqueTagIds) => updateEntryInput({ techniqueTagIds })}
      />
      <div className="rerate">
        <p className="field-label">Re-rate your feelings</p>
        {entryInput.emotions.length === 0 ? (
          <p className="empty-hint">
            No feelings rated yet.{' '}
            <button type="button" className="link-button" onClick={() => goToStep(1)}>
              Add them in Feelings
            </button>
          </p>
        ) : (
          <div className="slider-stack">
            {entryInput.emotions.map((emotionRating) =>
              emotionRating.intensityAfter === null ? (
                <button
                  key={emotionRating.tagId}
                  type="button"
                  className="rerate-start"
                  onClick={() => updateEmotion(emotionRating.tagId, { intensityAfter: emotionRating.intensityBefore })}
                >
                  <span>Re-rate {emotionName(emotionRating.tagId)}</span>
                  <span className="rerate-was">was {emotionRating.intensityBefore}</span>
                </button>
              ) : (
                <IntensitySlider
                  key={emotionRating.tagId}
                  tone="after"
                  label={emotionName(emotionRating.tagId)}
                  value={emotionRating.intensityAfter}
                  earlierValue={emotionRating.intensityBefore}
                  onChange={(intensityAfter) => updateEmotion(emotionRating.tagId, { intensityAfter })}
                />
              ),
            )}
          </div>
        )}
      </div>
    </>,
  ]

  return (
    <div className="editor">
      <header className="editor-bar">
        <button type="button" className="button button-quiet" onClick={closeEditor}>
          Close
        </button>
        <span className="editor-bar-title">{existingEntry ? 'Edit record' : 'New record'}</span>
        <button
          type="button"
          className="button button-quiet"
          disabled={isSaving || (!hasUnsavedChanges && !!existingEntry)}
          onClick={() => void saveEntry(quickSaveStatus)}
        >
          {quickSaveStatus === 'draft' ? 'Save draft' : 'Save'}
        </button>
      </header>

      <nav className="step-track" aria-label="Record sections">
        <ol>
          {EDITOR_STEPS.map((step, stepIndex) => (
            <li key={step.shortTitle}>
              <button
                type="button"
                className="step-track-button"
                aria-current={stepIndex === currentStepIndex ? 'step' : undefined}
                data-visited={stepIndex < currentStepIndex ? 'true' : undefined}
                onClick={() => goToStep(stepIndex)}
              >
                <span className="step-track-bar" aria-hidden="true" />
                <span className="step-track-label">{step.shortTitle}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="editor-step" aria-labelledby="editor-step-heading">
        <p className="step-count">
          {currentStepIndex + 1} of {EDITOR_STEPS.length}
        </p>
        <h1 id="editor-step-heading" ref={stepHeadingRef} tabIndex={-1}>
          {currentStep.title}
        </h1>
        <details className="helper">
          <summary>Questions that can help</summary>
          <ul>
            {currentStep.helperQuestions.map((helperQuestion) => (
              <li key={helperQuestion}>{helperQuestion}</li>
            ))}
          </ul>
        </details>
        <div className="editor-fields">{stepBodies[currentStepIndex]}</div>
        {saveError && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}
      </section>

      <footer className="editor-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={currentStepIndex === 0}
          onClick={() => goToStep(currentStepIndex - 1)}
        >
          Back
        </button>
        {isLastStep ? (
          <button type="button" className="button button-primary" disabled={isSaving} onClick={() => void saveEntry('complete')}>
            {isSaving ? 'Saving…' : 'Finish record'}
          </button>
        ) : (
          <button type="button" className="button button-primary" onClick={() => goToStep(currentStepIndex + 1)}>
            Next: {EDITOR_STEPS[currentStepIndex + 1]!.shortTitle}
          </button>
        )}
      </footer>
    </div>
  )
}

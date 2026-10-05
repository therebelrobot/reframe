import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type TagWithUsage } from './api'
import type { Entry, Tag } from '../shared/model'

/**
 * The decrypted journal, held only in React state for the life of the tab.
 * Nothing is written to localStorage, IndexedDB or a service worker cache.
 */
interface JournalData {
  entries: Entry[]
  tags: TagWithUsage[]
  tagById: Map<string, Tag>
  isLoading: boolean
  loadError: string | null
  refresh: () => Promise<void>
}

const JournalDataContext = createContext<JournalData | null>(null)

export function JournalDataProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [tags, setTags] = useState<TagWithUsage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [loadedEntries, loadedTags] = await Promise.all([api.listEntries(), api.listTags()])
      setEntries(loadedEntries)
      setTags(loadedTags)
      setLoadError(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load the journal.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const tagById = useMemo(() => new Map<string, Tag>(tags.map((tag) => [tag.id, tag])), [tags])

  const value = useMemo(
    () => ({ entries, tags, tagById, isLoading, loadError, refresh }),
    [entries, tags, tagById, isLoading, loadError, refresh],
  )
  return <JournalDataContext.Provider value={value}>{children}</JournalDataContext.Provider>
}

export function useJournalData(): JournalData {
  const journalData = useContext(JournalDataContext)
  if (!journalData) throw new Error('useJournalData must be used inside JournalDataProvider')
  return journalData
}

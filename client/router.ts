import { useEffect, useState } from 'react'

/** Hash routes: no server routing needed, and nothing sensitive ever lands in a URL path. */
export type Route =
  | { screen: 'entries' }
  | { screen: 'new-entry' }
  | { screen: 'entry'; entryId: string }
  | { screen: 'edit-entry'; entryId: string }
  | { screen: 'insights' }
  | { screen: 'tags' }
  | { screen: 'settings' }
  | { screen: 'report' }

export function parseRoute(hash: string): Route {
  const segments = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [first, second, third] = segments
  if (first === 'log') return { screen: 'new-entry' }
  if (first === 'entries' && second && third === 'edit') return { screen: 'edit-entry', entryId: second }
  if (first === 'entries' && second) return { screen: 'entry', entryId: second }
  if (first === 'insights') return { screen: 'insights' }
  if (first === 'tags') return { screen: 'tags' }
  if (first === 'settings') return { screen: 'settings' }
  if (first === 'report') return { screen: 'report' }
  return { screen: 'entries' }
}

export function navigateTo(hashPath: string, options: { replace?: boolean } = {}): void {
  const targetHash = `#${hashPath}`
  if (options.replace) {
    history.replaceState(null, '', targetHash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = targetHash
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const handleHashChange = () => {
      setRoute(parseRoute(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])
  return route
}

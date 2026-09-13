import { useSyncExternalStore } from 'react'
import type { Store } from './store.js'

/** Re-renders the component on every store change. */
export function useStore(store: Store): number {
  return useSyncExternalStore(
    (cb) => {
      store.on('change', cb)
      return () => store.off('change', cb)
    },
    () => store.version,
  )
}

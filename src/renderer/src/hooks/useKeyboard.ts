import { useEffect, useRef } from 'react'

export type KeyHandler = (e: KeyboardEvent) => void

/**
 * Global key handling. Keys are matched on `event.key` (e.g. 'ArrowRight', 'c', 'Home').
 * Keys are ignored while typing in a text field, and when Cmd/Ctrl/Alt is held unless the map
 * names the combination explicitly as 'Mod+z' (Cmd on macOS, Ctrl elsewhere).
 */
export function useKeyboard(map: Record<string, KeyHandler>, enabled = true): void {
  const ref = useRef(map)
  ref.current = map
  // Read at event time (not via effect re-subscription), so enabling/disabling takes effect on the
  // very next render — a key pressed right after a dialog closes isn't lost.
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // First handler wins. Without this, a key that opens something (e.g. '?') could also reach
      // the newly enabled handler that closes it: React re-renders between listeners (microtasks).
      if (!enabledRef.current || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const name = mod ? `Mod+${key}` : e.altKey ? `Alt+${key}` : key
      const handler = ref.current[name]
      if (!handler) return
      e.preventDefault()
      handler(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

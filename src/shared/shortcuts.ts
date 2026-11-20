// Keyboard shortcut names and labels, shared by the renderer and the main process.
// A key is stored as the KeyboardEvent.key the app matches on: single characters in lower case
// ('m', '1', ' '), named keys as-is ('ArrowUp', 'Home', 'Backspace').

/** Keys that can't be given to a playlist: dialogs need them. */
export const RESERVED_KEYS = ['Escape', 'Enter', 'Tab'] as const

const LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ' ': 'Space',
  Backspace: '⌫',
  Home: 'Home',
  End: 'End',
  Delete: 'Del',
  PageUp: 'PgUp',
  PageDown: 'PgDn'
}

/** The normalized name of a key press ('m', 'ArrowUp'), or null if it can't be a shortcut. */
export function shortcutName(key: string): string | null {
  if (key.length === 1) return key.toLowerCase()
  if (/^(Arrow(Up|Down|Left|Right)|Home|End|Backspace|Delete|PageUp|PageDown|F\d{1,2})$/.test(key)) return key
  return null
}

export function keyLabel(key: string): string {
  return LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key)
}

/** The built-in defaults: Like on ↑, Meh on ↓. */
export const DEFAULT_SHORTCUTS: Record<'like' | 'meh', string> = { like: 'ArrowUp', meh: 'ArrowDown' }

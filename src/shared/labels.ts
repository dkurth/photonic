import type { Status } from './types'

/**
 * Every user-visible word/emoticon for a status comes from here — never from the DB value.
 * Renaming a status in the UI is a one-line change.
 */
export const STATUS_LABELS: Record<Status, { label: string; emoticon: string }> = {
  unreviewed: { label: 'Unreviewed', emoticon: '' },
  like: { label: 'Like', emoticon: '⸜(｡˃ ᵕ ˂ )⸝♡' },
  meh: { label: 'Meh', emoticon: '¯\\_(ツ)_/¯' }
}

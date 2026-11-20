import type { Playlist } from './types'

/**
 * User-visible words and emoticons. Playlist names are the user's own; the two built-in playlists
 * (Like, Meh) also have an emoticon and their own colour.
 */
export const UNREVIEWED_LABEL = 'Unreviewed'

export const BUILTIN_EMOTICONS: Record<'like' | 'meh', string> = {
  like: '⸜(｡˃ ᵕ ˂ )⸝♡',
  meh: '¯\\_(ツ)_/¯'
}

export function playlistEmoticon(p: Pick<Playlist, 'builtin'> | null | undefined): string {
  return p?.builtin ? BUILTIN_EMOTICONS[p.builtin] : ''
}

/** CSS class giving a playlist its colour: Like and Meh have theirs, other playlists share one. */
export function playlistTone(p: Pick<Playlist, 'builtin'> | null | undefined): 'like' | 'meh' | 'other' {
  return p?.builtin ?? 'other'
}

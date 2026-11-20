import type { Playlist } from '@shared/types'
import { playlistEmoticon, playlistTone, UNREVIEWED_LABEL } from '@shared/labels'

/**
 * Notched ribbon tag showing which playlist a photo is in, like Gumroad's price tag (PLAN.md §12).
 * `playlist` null = Unreviewed.
 */
export function StatusTag({ playlist }: { playlist: Playlist | null }) {
  const tone = playlist ? playlistTone(playlist) : 'unreviewed'
  const emoticon = playlistEmoticon(playlist)
  return (
    <span
      className={`status-tag ${tone}`}
      data-testid="status-tag"
      data-status={playlist?.builtin ?? (playlist ? 'playlist' : 'unreviewed')}
      data-playlist={playlist?.id ?? ''}
    >
      {emoticon && <span className="emoticon">{emoticon}</span>}
      <span className="pixel">{(playlist?.name ?? UNREVIEWED_LABEL).toUpperCase()}</span>
    </span>
  )
}

import type { Playlist, StatusCounts } from '@shared/types'
import { playlistEmoticon, playlistTone } from '@shared/labels'
import { fmtNumber } from './format'

/** Shown when there's nowhere left to go (PLAN.md §2): a score per playlist, like an end-of-level screen. */
export function DoneScreen({
  counts,
  playlists,
  unreviewedEarlier
}: {
  counts: StatusCounts | null
  playlists: Playlist[]
  unreviewedEarlier: number
}) {
  // Like and Meh first, then other playlists that have photos.
  const shown = [...playlists]
    .filter((p) => p.builtin || (counts?.byPlaylist[p.id] ?? 0) > 0)
    .sort((a, b) => (a.builtin === 'like' ? -1 : b.builtin === 'like' ? 1 : a.builtin ? -1 : b.builtin ? 1 : 0))
  return (
    <div className="done-screen" data-testid="done-screen">
      <div className="done-title pixel">LIBRARY CLEAR!</div>
      {counts && (
        <div className="done-scores">
          {shown.map((p) => (
            <div key={p.id} className={`score ${playlistTone(p)}`} data-testid={`score-${p.id}`}>
              {playlistEmoticon(p) && <span className="emoticon">{playlistEmoticon(p)}</span>}
              <span className="pixel">{fmtNumber(counts.byPlaylist[p.id] ?? 0)}</span>
              <span>{p.name}</span>
            </div>
          ))}
        </div>
      )}
      {unreviewedEarlier > 0 ? (
        <p>
          {fmtNumber(unreviewedEarlier)} unreviewed earlier. Press <kbd className="keycap">Enter</kbd> to go to the
          first one.
        </p>
      ) : (
        <p>
          Press <kbd className="keycap">←</kbd> to go back.
        </p>
      )}
    </div>
  )
}

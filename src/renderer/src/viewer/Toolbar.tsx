import type { Playlist, StatusCounts } from '@shared/types'
import { playlistEmoticon, playlistTone } from '@shared/labels'
import { keyLabel } from '@shared/shortcuts'
import { Button } from '../components/Button'
import { ProgressBar } from '../components/ProgressBar'
import { SkipIcon } from '../components/SkipIcon'
import { fmtNumber } from './format'
import type { Flash } from './Stage'

/** A button for the playlist on ↓ or ↑ (Meh and Like unless you've changed them). */
function MarkButton({
  playlist,
  flash,
  pressed,
  canMark,
  onMark
}: {
  playlist: Playlist
  flash: Flash | null
  pressed: Set<string>
  canMark: boolean
  onMark: (playlistId: number) => void
}) {
  const wiggling = flash?.playlistId === playlist.id
  const emoticon = playlistEmoticon(playlist)
  return (
    <Button
      key={`pl-${playlist.id}-${wiggling ? flash!.n : 0}`}
      className={`mark-btn ${wiggling ? 'wiggle' : ''}`}
      variant={playlistTone(playlist) === 'other' ? 'other' : playlistTone(playlist)}
      keys={playlist.shortcut ? [keyLabel(playlist.shortcut)] : undefined}
      pressed={pressed.has(`pl-${playlist.id}`)}
      disabled={!canMark}
      onClick={() => onMark(playlist.id)}
      title={`Put in ${playlist.name}`}
    >
      {emoticon && <span className="emoticon">{emoticon}</span>} {playlist.name}
    </Button>
  )
}

export function Toolbar({
  index,
  total,
  pressed,
  counts,
  canMark,
  arrowPlaylists,
  flash,
  onFirst,
  onPrev,
  onNext,
  onLast,
  onMark
}: {
  index: number
  total: number
  pressed: Set<string>
  counts: StatusCounts | null
  canMark: boolean
  /** The playlists on ↓ and ↑ (either may be missing if you moved those keys elsewhere). */
  arrowPlaylists: { down?: Playlist; up?: Playlist }
  /** The last mark: its button wiggles (re-keyed so each mark restarts the animation). */
  flash: Flash | null
  onFirst: () => void
  onPrev: () => void
  onNext: () => void
  onLast: () => void
  onMark: (playlistId: number) => void
}) {
  const { down, up } = arrowPlaylists
  return (
    <footer className="toolbar">
      <div className="toolbar-left">
        <div className="position pixel" data-testid="position">
          {total ? `${fmtNumber(index + 1)} / ${fmtNumber(total)}` : '0 / 0'}
        </div>
        {counts && <ProgressBar value={counts.total - counts.unreviewed} total={counts.total} />}
      </div>
      <div className="controls">
        <Button
          className="icon-btn"
          pressed={pressed.has('first')}
          disabled={index <= 0}
          onClick={onFirst}
          title="First photo (Home)"
          ariaLabel="First photo"
        >
          <SkipIcon to="first" />
        </Button>
        <Button
          keys={['←']}
          pressed={pressed.has('prev')}
          disabled={index <= 0}
          onClick={onPrev}
          title="Previous photo"
        >
          Prev
        </Button>
        {down && <MarkButton playlist={down} flash={flash} pressed={pressed} canMark={canMark} onMark={onMark} />}
        {up && <MarkButton playlist={up} flash={flash} pressed={pressed} canMark={canMark} onMark={onMark} />}
        <Button keys={['→']} pressed={pressed.has('next')} disabled={total === 0} onClick={onNext} title="Next photo">
          Next
        </Button>
        <Button
          className="icon-btn"
          pressed={pressed.has('last')}
          disabled={index >= total - 1}
          onClick={onLast}
          title="Last photo (End)"
          ariaLabel="Last photo"
        >
          <SkipIcon to="last" />
        </Button>
      </div>
      <div className="toolbar-right counts" data-testid="counts">
        {counts && (
          <>
            {[up, down].map(
              (p) =>
                p && (
                  <span key={p.id} className="count" title={p.name}>
                    {p.builtin === 'like' ? '♡' : p.name.toLowerCase()}{' '}
                    <span className="pixel">{fmtNumber(counts.byPlaylist[p.id] ?? 0)}</span>
                  </span>
                )
            )}
            <span className="count unreviewed" title="Unreviewed">
              left <span className="pixel">{fmtNumber(counts.unreviewed)}</span>
            </span>
          </>
        )}
      </div>
    </footer>
  )
}

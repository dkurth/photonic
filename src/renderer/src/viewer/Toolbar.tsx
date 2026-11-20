import type { StatusCounts } from '@shared/types'
import { STATUS_LABELS } from '@shared/labels'
import { Button } from '../components/Button'
import { ProgressBar } from '../components/ProgressBar'
import { SkipIcon } from '../components/SkipIcon'
import type { Flash } from './Stage'
import { fmtNumber } from './format'

export function Toolbar({
  index,
  total,
  pressed,
  counts,
  canMark,
  onFirst,
  onPrev,
  onNext,
  onLast,
  flash,
  onLike,
  onMeh
}: {
  index: number
  total: number
  pressed: Set<string>
  counts: StatusCounts | null
  canMark: boolean
  onFirst: () => void
  onPrev: () => void
  onNext: () => void
  onLast: () => void
  /** The last mark: its button wiggles (re-keyed so each mark restarts the animation). */
  flash: Flash | null
  onLike: () => void
  onMeh: () => void
}) {
  return (
    <footer className="toolbar">
      <div className="toolbar-left">
        <div className="position pixel" data-testid="position">
          {total ? `${fmtNumber(index + 1)} / ${fmtNumber(total)}` : '0 / 0'}
        </div>
        {counts && <ProgressBar value={counts.like + counts.meh} total={counts.total} />}
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
        <Button
          key={`meh-${flash?.status === 'meh' ? flash.n : 0}`}
          className={flash?.status === 'meh' ? 'wiggle' : undefined}
          variant="meh"
          keys={['↓']}
          pressed={pressed.has('meh')}
          disabled={!canMark}
          onClick={onMeh}
          title="Meh: not selected"
        >
          <span className="emoticon">{STATUS_LABELS.meh.emoticon}</span> Meh
        </Button>
        <Button
          key={`like-${flash?.status === 'like' ? flash.n : 0}`}
          className={flash?.status === 'like' ? 'wiggle' : undefined}
          variant="like"
          keys={['↑']}
          pressed={pressed.has('like')}
          disabled={!canMark}
          onClick={onLike}
          title="Like: selected"
        >
          <span className="emoticon">{STATUS_LABELS.like.emoticon}</span> Like
        </Button>
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
            <span className="count like" title="Liked">
              ♡ <span className="pixel">{fmtNumber(counts.like)}</span>
            </span>
            <span className="count meh" title="Meh">
              meh <span className="pixel">{fmtNumber(counts.meh)}</span>
            </span>
            <span className="count unreviewed" title="Unreviewed">
              left <span className="pixel">{fmtNumber(counts.unreviewed)}</span>
            </span>
          </>
        )}
      </div>
    </footer>
  )
}

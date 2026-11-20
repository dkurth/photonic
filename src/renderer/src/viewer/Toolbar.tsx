import type { StatusCounts } from '@shared/types'
import { STATUS_LABELS } from '@shared/labels'
import { Button } from '../components/Button'
import { fmtNumber } from './format'

export function Toolbar({
  index,
  total,
  pressed,
  counts,
  canMark,
  onPrev,
  onNext,
  onLike,
  onMeh
}: {
  index: number
  total: number
  pressed: Set<string>
  counts: StatusCounts | null
  canMark: boolean
  onPrev: () => void
  onNext: () => void
  onLike: () => void
  onMeh: () => void
}) {
  return (
    <footer className="toolbar">
      <div className="position pixel" data-testid="position">
        {total ? `${fmtNumber(index + 1)} / ${fmtNumber(total)}` : '0 / 0'}
      </div>
      <div className="controls">
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

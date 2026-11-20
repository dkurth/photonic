import type { StatusCounts } from '@shared/types'
import { STATUS_LABELS } from '@shared/labels'
import { fmtNumber } from './format'

/** Shown when there's nowhere left to go (PLAN.md §2). */
export function DoneScreen({ counts, unreviewedEarlier }: { counts: StatusCounts | null; unreviewedEarlier: number }) {
  return (
    <div className="done-screen" data-testid="done-screen">
      <div className="done-title pixel">LIBRARY CLEAR!</div>
      {counts && (
        <div className="done-scores">
          <div className="score like">
            <span className="emoticon">{STATUS_LABELS.like.emoticon}</span>
            <span className="pixel">{fmtNumber(counts.like)}</span>
            <span>Liked</span>
          </div>
          <div className="score meh">
            <span className="emoticon">{STATUS_LABELS.meh.emoticon}</span>
            <span className="pixel">{fmtNumber(counts.meh)}</span>
            <span>Meh</span>
          </div>
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

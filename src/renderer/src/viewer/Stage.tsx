import { useState, type ReactNode } from 'react'
import type { PhotoMeta, Status } from '@shared/types'
import { STATUS_LABELS } from '@shared/labels'

export interface Flash {
  status: Status
  /** Increments on every mark, so the same status twice still re-triggers the animation. */
  n: number
}

/** The photo, on a neutral grey "screen" with a thick ink frame (PLAN.md §12). */
export function Stage({
  meta,
  empty,
  flash,
  overlay
}: {
  meta: PhotoMeta | null
  empty: string | null
  flash: Flash | null
  overlay?: ReactNode
}) {
  const [failedId, setFailedId] = useState<number | null>(null)
  const failed = meta && (meta.missing || failedId === meta.id)

  return (
    <div className="stage-wrap">
      <div className="stage" data-testid="stage">
        {meta && !failed && (
          <img
            key={`photo-${meta.id}`}
            src={meta.url}
            alt={meta.relPath}
            draggable={false}
            onError={() => setFailedId(meta.id)}
          />
        )}
        {meta && failed && (
          <div className="stage-message">
            <div className="pixel big">?!</div>
            <div>{meta.missing ? "This file isn't there anymore." : "Can't display this file."}</div>
            <div className="mono">{meta.absPath}</div>
          </div>
        )}
        {!meta && empty && (
          <div className="stage-message">
            <div>{empty}</div>
          </div>
        )}
        {flash && (
          <div key={`flash-${flash.n}`} className={`mark-flash ${flash.status}`} aria-hidden>
            {STATUS_LABELS[flash.status].emoticon && (
              <span className="mark-flash-badge">{STATUS_LABELS[flash.status].emoticon}</span>
            )}
          </div>
        )}
        {overlay}
      </div>
    </div>
  )
}

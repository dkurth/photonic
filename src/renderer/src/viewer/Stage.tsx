import { useState } from 'react'
import type { PhotoMeta } from '@shared/types'

/** The photo, on a neutral grey "screen" with a thick ink frame (PLAN.md §12). */
export function Stage({ meta, empty }: { meta: PhotoMeta | null; empty: string | null }) {
  const [failedId, setFailedId] = useState<number | null>(null)
  const failed = meta && (meta.missing || failedId === meta.id)

  return (
    <div className="stage-wrap">
      <div className="stage" data-testid="stage">
        {meta && !failed && (
          <img
            key={meta.id}
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
      </div>
    </div>
  )
}

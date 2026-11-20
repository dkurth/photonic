import type { Status } from '@shared/types'
import { STATUS_LABELS } from '@shared/labels'

/** Notched ribbon tag showing a photo's status, like Gumroad's price tag (PLAN.md §12). */
export function StatusTag({ status }: { status: Status }) {
  const l = STATUS_LABELS[status]
  return (
    <span className={`status-tag ${status}`} data-testid="status-tag" data-status={status}>
      {l.emoticon && <span className="emoticon">{l.emoticon}</span>}
      <span className="pixel">{l.label.toUpperCase()}</span>
    </span>
  )
}

import type { PhotoMeta } from '@shared/types'
import { Button } from '../components/Button'
import { dateLabel } from './format'

/** Full path and date of the current photo. Always visible (PLAN.md §7). */
export function InfoBar({
  meta,
  pressed,
  onCopy,
  onReveal
}: {
  meta: PhotoMeta | null
  pressed: Set<string>
  onCopy: () => void
  onReveal: () => void
}) {
  const date = meta ? dateLabel(meta) : null
  return (
    <section className="infobar" data-testid="infobar">
      <div className="path" data-testid="path">
        {meta?.absPath ?? ' '}
      </div>
      <div className="date" data-testid="date">
        {date?.label}
        {date?.note && <span className="note"> · {date.note}</span>}
      </div>
      <div className="infobar-actions">
        <Button size="small" keys={['C']} pressed={pressed.has('copy')} disabled={!meta} onClick={onCopy} title="Copy full path">
          Copy path
        </Button>
        <Button size="small" keys={['O']} pressed={pressed.has('reveal')} disabled={!meta} onClick={onReveal} title="Show in Finder">
          Finder
        </Button>
      </div>
    </section>
  )
}

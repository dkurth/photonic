import type { ReactNode } from 'react'
import type { PhotoMeta, Playlist } from '@shared/types'
import { Button } from '../components/Button'
import { StatusTag } from '../components/StatusTag'
import { dateLabel } from './format'

/** Full path and date of the current photo. Always visible (PLAN.md §7). */
export function InfoBar({
  meta,
  playlist,
  badges,
  pressed,
  onCopy,
  onReveal
}: {
  meta: PhotoMeta | null
  /** The playlist the photo is in (null = Unreviewed). */
  playlist: Playlist | null
  badges?: ReactNode
  pressed: Set<string>
  onCopy: () => void
  onReveal: () => void
}) {
  const date = meta ? dateLabel(meta) : null
  return (
    <section className="infobar" data-testid="infobar">
      <div className="tag-slot">{meta && <StatusTag playlist={playlist} />}</div>
      <div className="path" data-testid="path">
        {meta?.absPath ?? ' '}
      </div>
      <div className="date" data-testid="date">
        {date?.label}
        {badges}
      </div>
      <div className="infobar-actions">
        <Button
          size="small"
          keys={['C']}
          pressed={pressed.has('copy')}
          disabled={!meta}
          onClick={onCopy}
          title="Copy full path"
        >
          Copy path
        </Button>
        <Button
          size="small"
          keys={['O']}
          pressed={pressed.has('reveal')}
          disabled={!meta}
          onClick={onReveal}
          title="Show in Finder"
        >
          Finder
        </Button>
      </div>
    </section>
  )
}

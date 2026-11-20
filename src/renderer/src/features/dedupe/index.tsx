// UI for the dedupe feature (PLAN.md §8). Removable: delete this folder and its line in ../index.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DuplicateSummary, PhotoMeta } from '@shared/types'
import { Button } from '../../components/Button'
import { StatusTag } from '../../components/StatusTag'
import { useKeyboard } from '../../hooks/useKeyboard'
import { fmtNumber } from '../../viewer/format'
import type { FeatureContext, RendererFeature } from '../types'

const dismissedKey = (libraryId: number): string => `dedupe.dismissed.${libraryId}`

/** "1 of 3 copies" next to the date. */
function CopiesBadge({ ctx }: { ctx: FeatureContext }) {
  const [copies, setCopies] = useState(0)
  const id = ctx.meta?.id
  useEffect(() => {
    if (id === undefined) return setCopies(0)
    let live = true
    void window.photonic.duplicates.copies(id).then((c) => live && setCopies(c.length))
    return () => {
      live = false
    }
  }, [id, ctx.progress?.phase])
  if (!copies) return null
  return (
    <span className="copies-badge" data-testid="copies-badge" title="Identical copies (D to list them)">
      1 of {copies + 1} copies
    </span>
  )
}

function CopiesPanel({ meta, onClose }: { meta: PhotoMeta; onClose: () => void }) {
  const [copies, setCopies] = useState<PhotoMeta[] | null>(null)
  useEffect(() => {
    void window.photonic.duplicates.copies(meta.id).then(setCopies)
  }, [meta.id])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Identical copies" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title pixel">IDENTICAL COPIES</div>
        <div className="copies-list">
          <div className="copy-row current">
            <StatusTag status={meta.status} />
            <span className="mono">{meta.absPath}</span>
            <span className="note">this one</span>
          </div>
          {copies?.map((c) => (
            <div key={c.id} className="copy-row">
              <StatusTag status={c.status} />
              <span className="mono">{c.absPath}</span>
            </div>
          ))}
          {copies?.length === 0 && <div className="note">No identical copies.</div>}
        </div>
        <div className="modal-actions">
          <Button size="small" keys={['Esc']} onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}

function ConfirmHide({ count, onConfirm, onClose }: { count: number; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Hide duplicates" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title pixel">HIDE DUPLICATES</div>
        <p>
          Mark <strong>{fmtNumber(count)}</strong> extra {count === 1 ? 'copy' : 'copies'} as Meh? One copy of each
          photo stays, and photos you already marked are not changed. No files are touched, and{' '}
          <kbd className="keycap">⌘Z</kbd> undoes it all.
        </p>
        <div className="modal-actions">
          <Button size="small" keys={['Esc']} onClick={onClose}>
            Cancel
          </Button>
          <Button size="small" variant="meh" keys={['↵']} onClick={onConfirm}>
            Mark as Meh
          </Button>
        </div>
      </div>
    </div>
  )
}

function DedupeLayer({ ctx }: { ctx: FeatureContext }) {
  const api = window.photonic
  const [summary, setSummary] = useState<DuplicateSummary | null>(null)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [panel, setPanelState] = useState<'copies' | { confirm: number } | null>(null)
  const { libraryId, setModalOpen } = ctx
  // Tell the Viewer in the same update, so its shortcuts pause/resume exactly with the dialog.
  const setPanel = useCallback(
    (p: 'copies' | { confirm: number } | null) => {
      setPanelState(p)
      setModalOpen(p !== null)
    },
    [setModalOpen]
  )

  const refresh = useCallback(() => void api.duplicates.summary(libraryId).then(setSummary), [api, libraryId])

  useEffect(() => {
    void api.settings.get<number>(dismissedKey(libraryId)).then(setDismissed)
  }, [api, libraryId])

  // Refresh when a scan phase ends (hashing finishing is what makes the count final).
  const phase = ctx.progress?.phase
  useEffect(refresh, [refresh, phase])

  const startHide = useCallback(async () => {
    const count = await api.duplicates.previewHide(libraryId)
    if (!count) ctx.toast('No duplicates to hide')
    else setPanel({ confirm: count })
  }, [api, ctx, libraryId])

  const confirmHide = useCallback(async () => {
    setPanel(null)
    const r = await api.duplicates.hide(libraryId)
    await ctx.reload()
    refresh()
    ctx.toast(`Marked ${fmtNumber(r.marked)} copies as Meh — ⌘Z to undo`)
  }, [api, ctx, libraryId, refresh])

  const dismiss = useCallback(() => {
    if (!summary) return
    setDismissed(summary.extraCopies)
    void api.settings.set(dismissedKey(libraryId), summary.extraCopies)
  }, [api, libraryId, summary])

  // Menu: Library → Hide Duplicates…
  const startHideRef = useRef(startHide)
  startHideRef.current = startHide
  useEffect(() => api.onMenu((cmd) => cmd === 'hide-duplicates' && void startHideRef.current()), [api])

  useKeyboard({ d: () => ctx.meta && setPanel('copies') }, panel === null)
  useKeyboard(
    {
      Escape: () => setPanel(null),
      Enter: () => typeof panel === 'object' && panel !== null && void confirmHide()
    },
    panel !== null
  )

  const showBanner =
    summary?.hashingDone &&
    summary.extraCopies > 0 &&
    dismissed !== summary.extraCopies &&
    ctx.view.filter !== 'duplicates'

  return (
    <>
      {showBanner && (
        <div className="banner" role="status" data-testid="dup-banner">
          <span>
            <strong>{fmtNumber(summary.extraCopies)}</strong> duplicate {summary.extraCopies === 1 ? 'copy' : 'copies'}{' '}
            found.
          </span>
          <Button size="small" variant="meh" onClick={() => void startHide()}>
            Hide duplicates
          </Button>
          <Button size="small" keys={['5']} onClick={() => ctx.setFilter('duplicates')}>
            Review
          </Button>
          <Button size="small" onClick={dismiss}>
            Dismiss
          </Button>
        </div>
      )}
      {panel === 'copies' && ctx.meta && <CopiesPanel meta={ctx.meta} onClose={() => setPanel(null)} />}
      {typeof panel === 'object' && panel !== null && (
        <ConfirmHide count={panel.confirm} onConfirm={() => void confirmHide()} onClose={() => setPanel(null)} />
      )}
    </>
  )
}

export const dedupe: RendererFeature = {
  name: 'dedupe',
  filters: [{ id: 'duplicates', key: '5', label: 'Duplicates' }],
  Layer: DedupeLayer,
  InfoBadge: CopiesBadge,
  shortcuts: [
    { keys: ['5'], label: 'Show only duplicates' },
    { keys: ['D'], label: 'List identical copies' }
  ]
}

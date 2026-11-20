import { useCallback, useEffect, useRef, useState } from 'react'
import type { FolderTarget } from '@shared/types'
import { STATUS_LABELS } from '@shared/labels'
import { Button } from '../components/Button'
import { useKeyboard } from '../hooks/useKeyboard'
import { fmtNumber } from './format'

type Mark = 'like' | 'meh'
const VERB: Record<Mark, string> = { like: 'Like', meh: 'Meh' }
const OTHER: Record<Mark, Mark> = { like: 'meh', meh: 'like' }

/**
 * F: Like or Meh every photo in a folder (subfolders included) in one go. If that would overwrite
 * the opposite mark on some photos, asks whether to overwrite them or only mark the unreviewed ones.
 */
export function FolderMarkDialog({
  libraryId,
  initialPath,
  onDone,
  onClose
}: {
  libraryId: number
  initialPath: string
  onDone: (result: { changed: number; status: Mark }) => void
  onClose: () => void
}) {
  const api = window.photonic
  const [path, setPath] = useState(initialPath)
  const [target, setTarget] = useState<FolderTarget | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Mark | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.select(), [])

  // Look the folder up as the path is typed (debounced).
  useEffect(() => {
    let live = true
    const t = window.setTimeout(() => {
      void api.folders.resolve(libraryId, path).then((r) => {
        if (!live) return
        if ('error' in r) {
          setTarget(null)
          setError(r.error)
        } else {
          setTarget(r)
          setError(null)
        }
      })
    }, 120)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [api, libraryId, path])

  const apply = useCallback(
    async (status: Mark, mode: 'all' | 'unreviewed') => {
      if (!target || busy) return
      setBusy(true)
      const r = await api.folders.mark(libraryId, target.dirPath, status, mode)
      onDone({ changed: r.changed, status })
    },
    [api, busy, libraryId, onDone, target]
  )

  /** Meh/Like clicked: ask first if photos carry the opposite mark. */
  const choose = useCallback(
    (status: Mark) => {
      if (!target || target.total === 0) return
      if (target[OTHER[status]] > 0) setConfirm(status)
      else void apply(status, 'all')
    },
    [apply, target]
  )

  const browse = useCallback(async () => {
    const picked = await api.folders.pick(libraryId)
    if (picked) setPath(picked)
    inputRef.current?.focus()
  }, [api, libraryId])

  // On the confirm step (focus is no longer in the text field): A = all, U = only unreviewed.
  useKeyboard(
    {
      a: () => confirm && void apply(confirm, 'all'),
      u: () => confirm && void apply(confirm, 'unreviewed'),
      Escape: () => (confirm ? setConfirm(null) : onClose())
    },
    true
  )

  const canMark = !!target && target.total > 0 && !busy

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal folder-mark"
        role="dialog"
        aria-label="Like or Meh a folder"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title pixel">LIKE OR MEH A FOLDER</div>
        {!confirm ? (
          <>
            <div className="path-row">
              <input
                ref={inputRef}
                autoFocus
                className="search mono-input"
                spellCheck={false}
                placeholder="/path/to/a/folder in this library"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => {
                  // ↑/↓ mark (like everywhere else); Escape closes.
                  if (e.key === 'ArrowUp') choose('like')
                  else if (e.key === 'ArrowDown') choose('meh')
                  else if (e.key === 'Escape') onClose()
                  else return
                  e.preventDefault()
                  e.stopPropagation()
                }}
                data-testid="folder-path"
              />
              <Button size="small" onClick={() => void browse()}>
                Browse…
              </Button>
            </div>
            <div className={`folder-summary ${error ? 'error' : ''}`} data-testid="folder-summary" role="status">
              {error ??
                (target &&
                  (target.total === 0 ? (
                    'No photos in this folder.'
                  ) : (
                    <>
                      <strong>{fmtNumber(target.total)}</strong> {target.total === 1 ? 'photo' : 'photos'} in this
                      folder (including subfolders)
                      {(target.like > 0 || target.meh > 0) && (
                        <span className="note">
                          {' '}
                          · {fmtNumber(target.unreviewed)} unreviewed, {fmtNumber(target.like)} Like,{' '}
                          {fmtNumber(target.meh)} Meh
                        </span>
                      )}
                    </>
                  )))}
            </div>
            <div className="modal-actions">
              <Button size="small" keys={['Esc']} onClick={onClose}>
                Cancel
              </Button>
              <Button size="small" variant="meh" keys={['↓']} disabled={!canMark} onClick={() => choose('meh')}>
                <span className="emoticon">{STATUS_LABELS.meh.emoticon}</span> Meh
              </Button>
              <Button size="small" variant="like" keys={['↑']} disabled={!canMark} onClick={() => choose('like')}>
                <span className="emoticon">{STATUS_LABELS.like.emoticon}</span> Like
              </Button>
            </div>
          </>
        ) : (
          <>
            <p data-testid="folder-confirm">
              <strong>{fmtNumber(target![OTHER[confirm]])}</strong> {target![OTHER[confirm]] === 1 ? 'photo' : 'photos'}{' '}
              in that folder {target![OTHER[confirm]] === 1 ? 'is' : 'are'} marked {VERB[OTHER[confirm]]}. Do you want
              to overwrite that?
            </p>
            <div className="modal-actions">
              <Button size="small" keys={['Esc']} onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button size="small" keys={['U']} disabled={busy} onClick={() => void apply(confirm, 'unreviewed')}>
                {VERB[confirm]} only the unreviewed ones
              </Button>
              <Button
                size="small"
                variant={confirm}
                keys={['A']}
                disabled={busy}
                onClick={() => void apply(confirm, 'all')}
              >
                {VERB[confirm]} them all
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

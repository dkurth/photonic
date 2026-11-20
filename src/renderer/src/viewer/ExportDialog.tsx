import { useEffect, useState } from 'react'
import type { ExportNaming, ExportProgress, ExportResult, Playlist } from '@shared/types'
import { Button } from '../components/Button'
import { ProgressBar } from '../components/ProgressBar'
import { useKeyboard } from '../hooks/useKeyboard'
import { fmtNumber } from './format'

/** Example names for each option, e.g. "001.jpg, 002.jpg … 250.jpg". */
function examples(naming: ExportNaming, n: number): string {
  if (naming === 'sequential') {
    const d = Math.max(3, String(n).length)
    const num = (i: number): string => String(i).padStart(d, '0') + '.jpg'
    return n > 2 ? `${num(1)}, ${num(2)} … ${num(n)}` : [1, 2].slice(0, Math.max(n, 1)).map(num).join(', ')
  }
  if (naming === 'date') return '20190704_153012.jpg, 20190704_153012_2.jpg (same second)'
  return 'IMG_0042.jpg, IMG_0042_2.jpg (same name)'
}

const OPTIONS: { value: ExportNaming; label: string }[] = [
  { value: 'original', label: 'Keep the file names' },
  { value: 'sequential', label: 'Rename files sequentially' },
  { value: 'date', label: 'Rename files with date' }
]

/**
 * Manage Playlists → Export: copies a playlist's photos into one folder, flat. The originals are
 * never touched and nothing in the folder is overwritten (PLAN.md §15).
 */
export function ExportDialog({ playlist, onClose }: { playlist: Playlist; onClose: () => void }) {
  const api = window.photonic.exports
  const [dest, setDest] = useState<string | null>(null)
  const [naming, setNaming] = useState<ExportNaming>('original')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(playlist.photoCount)

  const pick = async (): Promise<void> => {
    const dir = await api.pickFolder()
    if (dir) setDest(dir)
  }

  // Ask for the folder straight away; the dialog stays open if that's cancelled.
  useEffect(() => {
    void pick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => api.onProgress(setProgress), [api])
  useEffect(() => void api.count(playlist.id).then(setN), [api, playlist.id])

  const start = async (): Promise<void> => {
    if (!dest || running) return
    setRunning(true)
    setError(null)
    setProgress({ done: 0, total: n })
    try {
      setResult(await api.run(playlist.id, dest, naming))
    } catch (e) {
      setError(String(e).replace(/^.*Error: /, ''))
    } finally {
      setRunning(false)
    }
  }

  // Esc: stop a running export, else close.
  useKeyboard({ Escape: () => (running ? void api.cancel() : onClose()) }, true)

  const missing = result?.failed.filter((f) => f.reason === 'missing').length ?? 0
  const otherFailures = result ? result.failed.length - missing : 0

  return (
    <div className="modal-backdrop" onMouseDown={() => !running && onClose()}>
      <div
        className="modal export-dialog"
        role="dialog"
        aria-label={`Export ${playlist.name}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title pixel">EXPORT {playlist.name.toUpperCase()}</div>

        {result ? (
          <>
            <p data-testid="export-result">
              {result.cancelled ? 'Stopped. ' : ''}Copied <strong>{fmtNumber(result.copied)}</strong>{' '}
              {result.copied === 1 ? 'photo' : 'photos'} to <span className="mono">{result.destDir}</span>.
            </p>
            {missing > 0 && (
              <p className="note">
                {fmtNumber(missing)} {missing === 1 ? 'photo was' : 'photos were'} skipped because the original isn’t
                there any more.
              </p>
            )}
            {otherFailures > 0 && (
              <p className="note" title={result.failed.map((f) => `${f.path}: ${f.reason}`).join('\n')}>
                {fmtNumber(otherFailures)} {otherFailures === 1 ? 'photo' : 'photos'} couldn’t be copied (hover for
                details).
              </p>
            )}
            <div className="modal-actions">
              <Button size="small" onClick={() => void api.reveal(result.destDir)}>
                Show in Finder
              </Button>
              <Button size="small" variant="accent" keys={['Esc']} onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>
              Copies the {fmtNumber(n)} {n === 1 ? 'photo' : 'photos'} in {playlist.name} into one folder (no
              subfolders). The originals stay where they are, and nothing already in the folder is overwritten.
            </p>
            <div className="path-row">
              <div className={`export-dest mono ${dest ? '' : 'empty'}`} data-testid="export-dest">
                {dest ?? 'No folder chosen'}
              </div>
              <Button size="small" disabled={running} onClick={() => void pick()}>
                {dest ? 'Change…' : 'Choose folder…'}
              </Button>
            </div>
            <div className="export-options" role="radiogroup" aria-label="File names">
              {OPTIONS.map((o) => (
                <label key={o.value} className={`export-option ${naming === o.value ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="naming"
                    value={o.value}
                    checked={naming === o.value}
                    disabled={running}
                    onChange={() => setNaming(o.value)}
                    data-testid={`export-naming-${o.value}`}
                  />
                  <span>
                    {o.label}
                    <span className="note mono"> {examples(o.value, n)}</span>
                  </span>
                </label>
              ))}
            </div>
            {running && progress && (
              <div className="export-progress" data-testid="export-progress">
                <ProgressBar value={progress.done} total={progress.total} what="copied" />
                <span className="note">
                  {fmtNumber(progress.done)} / {fmtNumber(progress.total)}
                </span>
              </div>
            )}
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <div className="modal-actions">
              {running ? (
                <Button size="small" keys={['Esc']} onClick={() => void api.cancel()}>
                  Stop
                </Button>
              ) : (
                <Button size="small" keys={['Esc']} onClick={onClose}>
                  Cancel
                </Button>
              )}
              <Button
                size="small"
                variant="accent"
                disabled={!dest || running || n === 0}
                onClick={() => void start()}
                ariaLabel="Export"
              >
                {running ? 'Copying…' : 'Export'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

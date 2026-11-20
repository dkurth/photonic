import { useCallback, useEffect, useRef, useState } from 'react'
import type { FolderTarget, Playlist } from '@shared/types'
import { playlistEmoticon, playlistTone } from '@shared/labels'
import { keyLabel } from '@shared/shortcuts'
import { Button } from '../components/Button'
import { useKeyboard } from '../hooks/useKeyboard'
import { fmtNumber } from './format'

/** "Meh them all" for Like/Meh (the verbs), "Put them all in memes" for other playlists. */
function choiceLabels(p: Playlist): { all: string; unreviewed: string } {
  return p.builtin
    ? { all: `${p.name} them all`, unreviewed: `${p.name} only the unreviewed ones` }
    : { all: `Put them all in ${p.name}`, unreviewed: 'Only the unreviewed ones' }
}

/**
 * F: put every photo in a folder (subfolders included) in a playlist in one go. If some photos are
 * already in other playlists, asks whether to move them too or only the unreviewed ones.
 */
export function FolderMarkDialog({
  libraryId,
  initialPath,
  playlists,
  onDone,
  onClose
}: {
  libraryId: number
  initialPath: string
  playlists: Playlist[]
  onDone: (result: { changed: number; playlist: Playlist }) => void
  onClose: () => void
}) {
  const api = window.photonic
  const [path, setPath] = useState(initialPath)
  const [target, setTarget] = useState<FolderTarget | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Playlist | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const up = playlists.find((p) => p.shortcut === 'ArrowUp')
  const down = playlists.find((p) => p.shortcut === 'ArrowDown')
  // ↓ and ↑ first (as in the toolbar), then the rest alphabetically.
  const ordered = [down, up, ...playlists.filter((p) => p !== up && p !== down)].filter((p): p is Playlist => !!p)

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
    async (playlist: Playlist, mode: 'all' | 'unreviewed') => {
      if (!target || busy) return
      setBusy(true)
      const r = await api.folders.mark(libraryId, target.dirPath, playlist.id, mode)
      onDone({ changed: r.changed, playlist })
    },
    [api, busy, libraryId, onDone, target]
  )

  /** Photos in the folder that are in a playlist other than `p`. */
  const elsewhere = (p: Playlist): number =>
    target ? target.total - target.unreviewed - (target.byPlaylist[p.id] ?? 0) : 0

  /** A playlist was chosen: ask first if photos are already in other playlists. */
  const choose = useCallback(
    (p: Playlist | undefined) => {
      if (!p || !target || target.total === 0) return
      if (elsewhere(p) > 0) setConfirm(p)
      else void apply(p, 'all')
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /** "20 photos in that folder are marked Like" / "…are in other playlists (12 Like, 8 memes)". */
  const conflictText = (p: Playlist): string => {
    const n = elsewhere(p)
    const others = playlists.filter((o) => o.id !== p.id && (target?.byPlaylist[o.id] ?? 0) > 0)
    const photos = `${fmtNumber(n)} ${n === 1 ? 'photo' : 'photos'} in that folder ${n === 1 ? 'is' : 'are'}`
    if (others.length === 1) {
      const o = others[0]
      return `${photos} ${o.builtin ? 'marked' : 'in'} ${o.name}. Do you want to overwrite that?`
    }
    const list = others.map((o) => `${fmtNumber(target!.byPlaylist[o.id])} ${o.name}`).join(', ')
    return `${photos} in other playlists (${list}). Do you want to overwrite that?`
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal folder-mark"
        role="dialog"
        aria-label="Put a folder in a playlist"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title pixel">PUT A FOLDER IN A PLAYLIST</div>
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
                  // ↑/↓ put it in those keys' playlists (like everywhere else); Escape closes.
                  if (e.key === 'ArrowUp') choose(up)
                  else if (e.key === 'ArrowDown') choose(down)
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
                      {target.unreviewed < target.total && (
                        <span className="note">
                          {' '}
                          · {fmtNumber(target.unreviewed)} unreviewed
                          {playlists
                            .filter((p) => (target.byPlaylist[p.id] ?? 0) > 0)
                            .map((p) => `, ${fmtNumber(target.byPlaylist[p.id])} ${p.name}`)
                            .join('')}
                        </span>
                      )}
                    </>
                  )))}
            </div>
            <div className="modal-actions wrap">
              <Button size="small" keys={['Esc']} onClick={onClose}>
                Cancel
              </Button>
              {ordered.map((p) => (
                <Button
                  key={p.id}
                  size="small"
                  variant={playlistTone(p) === 'other' ? 'other' : playlistTone(p)}
                  keys={p === up || p === down ? [keyLabel(p.shortcut!)] : undefined}
                  disabled={!canMark}
                  onClick={() => choose(p)}
                >
                  {playlistEmoticon(p) && <span className="emoticon">{playlistEmoticon(p)}</span>} {p.name}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p data-testid="folder-confirm">{conflictText(confirm)}</p>
            <div className="modal-actions">
              <Button size="small" keys={['Esc']} onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button size="small" keys={['U']} disabled={busy} onClick={() => void apply(confirm, 'unreviewed')}>
                {choiceLabels(confirm).unreviewed}
              </Button>
              <Button
                size="small"
                variant={playlistTone(confirm) === 'other' ? 'other' : playlistTone(confirm)}
                keys={['A']}
                disabled={busy}
                onClick={() => void apply(confirm, 'all')}
              >
                {choiceLabels(confirm).all}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

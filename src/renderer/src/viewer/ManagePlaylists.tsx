import { useCallback, useEffect, useState } from 'react'
import type { Playlist } from '@shared/types'
import { playlistTone } from '@shared/labels'
import { keyLabel, RESERVED_KEYS, shortcutName } from '@shared/shortcuts'
import { Button } from '../components/Button'
import { KeyCap } from '../components/KeyCap'
import { useKeyboard } from '../hooks/useKeyboard'
import { ExportDialog } from './ExportDialog'
import { fmtNumber } from './format'
import type { SystemShortcut } from './shortcuts'

type Pending =
  | { kind: 'system'; playlist: Playlist; key: string; label: string }
  | { kind: 'playlist'; playlist: Playlist; key: string; other: Playlist }

/** Name field that saves on Enter/blur and shows why a name was refused. */
function NameField({ playlist, onError }: { playlist: Playlist; onError: (msg: string | null) => void }) {
  const [value, setValue] = useState(playlist.name)
  useEffect(() => setValue(playlist.name), [playlist.name])
  const save = async (): Promise<void> => {
    if (value.trim() === playlist.name) return
    try {
      await window.photonic.playlists.rename(playlist.id, value)
      onError(null)
    } catch (e) {
      onError(String(e).replace(/^.*Error: /, ''))
      setValue(playlist.name)
    }
  }
  return (
    <input
      className="search name-input"
      value={value}
      aria-label={`Name of ${playlist.name}`}
      data-testid={`playlist-name-${playlist.id}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setValue(playlist.name)
          e.stopPropagation()
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/**
 * Playlists → Manage Playlists… (PLAN.md §12): rename, delete, and give each playlist a single-key
 * shortcut. Clashes with the app's own shortcuts are allowed after a warning (the playlist wins);
 * "Reset shortcuts" puts Like/Meh back on ↑/↓ and drops clashing keys.
 */
export function ManagePlaylists({
  playlists,
  system,
  onClose
}: {
  playlists: Playlist[]
  system: SystemShortcut[]
  onClose: () => void
}) {
  const api = window.photonic.playlists
  const [capturing, setCapturing] = useState<Playlist | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [deleting, setDeleting] = useState<{ playlist: Playlist; moveTo: number | null } | null>(null)
  const [newName, setNewName] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState<Playlist | null>(null)

  const assign = useCallback(
    async (p: Playlist, key: string | null) => {
      await api.setShortcut(p.id, key)
      setPending(null)
      setCapturing(null)
      setMessage(null)
    },
    [api]
  )

  // Key capture: the next key press becomes the shortcut (Esc cancels).
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') return setCapturing(null)
      if (['Shift', 'Meta', 'Control', 'Alt', 'CapsLock'].includes(e.key)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return setMessage('Use a single key, without ⌘, ⌃ or ⌥.')
      const key = shortcutName(e.key)
      if (!key || (RESERVED_KEYS as readonly string[]).includes(e.key)) {
        return setMessage(`${e.key} can't be a playlist shortcut.`)
      }
      const p = capturing
      setCapturing(null)
      if (p.shortcut === key) return
      const other = playlists.find((o) => o.shortcut === key && o.id !== p.id)
      if (other) return setPending({ kind: 'playlist', playlist: p, key, other })
      const sys = system.find((s) => s.key === key)
      if (sys) return setPending({ kind: 'system', playlist: p, key, label: sys.label })
      void assign(p, key)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [assign, capturing, playlists, system])

  // Esc steps back (a pending question, then the delete confirmation, then the dialog), also while
  // typing in a field — except a name field, which uses Esc to undo its edit (it stops the event).
  const onEscape = (): void => {
    if (pending) setPending(null)
    else if (deleting) setDeleting(null)
    else onClose()
  }
  // Focus outside a text field: the shared key hook (it ignores text fields, which the dialog's own
  // onKeyDown below covers — so exactly one of the two handles any Esc).
  useKeyboard({ Escape: onEscape }, !capturing && !exporting)

  const create = async (): Promise<void> => {
    if (!newName.trim()) return
    try {
      await api.create(newName)
      setNewName('')
      setMessage(null)
    } catch (e) {
      setMessage(String(e).replace(/^.*Error: /, ''))
    }
  }

  const reset = async (): Promise<void> => {
    await api.resetShortcuts([...new Set(system.map((s) => s.key))])
    setMessage('Shortcuts reset: Like is ↑, Meh is ↓, and keys that clashed with the app’s own were removed.')
  }

  if (exporting) {
    // Shown instead of this dialog; closing it comes back here.
    const fresh = playlists.find((p) => p.id === exporting.id) ?? exporting
    return <ExportDialog playlist={fresh} onClose={() => setExporting(null)} />
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal manage-playlists"
        role="dialog"
        aria-label="Manage playlists"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement
          if (e.key === 'Escape' && !capturing && inField) {
            e.preventDefault()
            onEscape()
          }
        }}
      >
        <div className="modal-title pixel">PLAYLISTS</div>
        <div className="playlist-rows">
          {playlists.map((p) => (
            <div key={p.id} className="playlist-row" data-testid={`playlist-row-${p.id}`}>
              <span className={`pl-swatch ${playlistTone(p)}`} title={p.builtin ? `${p.name} (built in)` : p.name} />
              <NameField playlist={p} onError={setMessage} />
              <span className="pl-count">
                <span className="pixel">{fmtNumber(p.photoCount)}</span> {p.photoCount === 1 ? 'photo' : 'photos'}
              </span>
              <button
                className={`chip key-chip ${capturing?.id === p.id ? 'capturing' : ''}`}
                onClick={() => (setMessage(null), setCapturing(capturing?.id === p.id ? null : p))}
                onMouseDown={(e) => e.preventDefault()}
                title="Click, then press a key"
                data-testid={`playlist-key-${p.id}`}
              >
                {capturing?.id === p.id ? (
                  'Press a key…'
                ) : p.shortcut ? (
                  <KeyCap k={keyLabel(p.shortcut)} />
                ) : (
                  <span className="note">Set key</span>
                )}
              </button>
              <button
                className="icon-text"
                disabled={!p.shortcut}
                onClick={() => void assign(p, null)}
                title="Remove the key"
                aria-label={`Remove ${p.name}'s key`}
              >
                ✕ key
              </button>
              <Button
                size="small"
                disabled={p.photoCount === 0}
                onClick={() => setExporting(p)}
                title={p.photoCount ? `Copy ${p.name}'s photos to a folder` : `${p.name} has no photos`}
                className="export-btn"
              >
                Export
              </Button>
              {p.builtin ? (
                <span className="note builtin-note">built in</span>
              ) : (
                <Button
                  size="small"
                  onClick={() => setDeleting({ playlist: p, moveTo: null })}
                  title={`Delete ${p.name}`}
                >
                  Delete
                </Button>
              )}
            </div>
          ))}
        </div>

        {pending && (
          <div className="inline-confirm" role="alert" data-testid="key-conflict">
            <span>
              {pending.kind === 'system' ? (
                <>
                  <KeyCap k={keyLabel(pending.key)} /> is used for “{pending.label}”. Use it for {pending.playlist.name}{' '}
                  anyway? (The playlist will take priority.)
                </>
              ) : (
                <>
                  <KeyCap k={keyLabel(pending.key)} /> is used by {pending.other.name}. Give it to{' '}
                  {pending.playlist.name} instead?
                </>
              )}
            </span>
            <Button size="small" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button size="small" variant="accent" onClick={() => void assign(pending.playlist, pending.key)}>
              {pending.kind === 'system' ? 'Use it' : 'Move it'}
            </Button>
          </div>
        )}

        {deleting && (
          <div className="inline-confirm" role="alert" data-testid="delete-confirm">
            <span>
              {deleting.playlist.photoCount > 0 ? (
                <>
                  {deleting.playlist.name} has {fmtNumber(deleting.playlist.photoCount)}{' '}
                  {deleting.playlist.photoCount === 1 ? 'photo' : 'photos'}. Move them to{' '}
                  <select
                    value={deleting.moveTo ?? ''}
                    onChange={(e) =>
                      setDeleting({ ...deleting, moveTo: e.target.value === '' ? null : Number(e.target.value) })
                    }
                    data-testid="delete-move-to"
                  >
                    <option value="">Unreviewed</option>
                    {playlists
                      .filter((o) => o.id !== deleting.playlist.id)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>{' '}
                  and delete the playlist? This can’t be undone.
                </>
              ) : (
                <>Delete {deleting.playlist.name}? This can’t be undone.</>
              )}
            </span>
            <Button size="small" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="like"
              onClick={() =>
                void api.remove(deleting.playlist.id, deleting.moveTo).then(() => {
                  setDeleting(null)
                  setMessage(null)
                })
              }
            >
              Delete playlist
            </Button>
          </div>
        )}

        <div className="new-playlist">
          <input
            className="search"
            placeholder="New playlist name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            data-testid="new-playlist-name"
          />
          <Button size="small" variant="accent" onClick={() => void create()}>
            Add playlist
          </Button>
        </div>

        {message && (
          <div className="note manage-message" role="status" data-testid="manage-message">
            {message}
          </div>
        )}

        <div className="modal-actions">
          <Button
            size="small"
            onClick={() => void reset()}
            title="Like = ↑, Meh = ↓; removes keys that clash with the app’s own"
          >
            Reset shortcuts
          </Button>
          <Button size="small" keys={['Esc']} onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}

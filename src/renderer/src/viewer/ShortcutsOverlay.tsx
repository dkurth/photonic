import type { Playlist } from '@shared/types'
import { playlistEmoticon } from '@shared/labels'
import { keyLabel } from '@shared/shortcuts'
import { KeyCap } from '../components/KeyCap'
import type { SystemShortcut } from './shortcuts'

const GROUPS: SystemShortcut['group'][] = ['Review', 'View', 'Photo & window']

/** `?`: every shortcut, including playlist keys. An app shortcut a playlist took over is struck through. */
export function ShortcutsOverlay({
  system,
  playlists,
  onClose
}: {
  system: SystemShortcut[]
  playlists: Playlist[]
  onClose: () => void
}) {
  const byKey = new Map(playlists.filter((p) => p.shortcut).map((p) => [p.shortcut!, p]))
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal shortcuts"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title pixel">KEYBOARD SHORTCUTS</div>
        <div className="shortcut-groups">
          <section>
            <h4>Playlists</h4>
            {playlists
              .filter((p) => p.shortcut)
              .map((p) => (
                <div key={p.id} className="shortcut">
                  <span className="shortcut-keys">
                    <KeyCap k={keyLabel(p.shortcut!)} />
                  </span>
                  <span>
                    {p.name} {playlistEmoticon(p)}
                  </span>
                </div>
              ))}
            <div className="shortcut note">Change these in Playlists → Manage Playlists…</div>
          </section>
          {GROUPS.map((g) => (
            <section key={g}>
              <h4>{g}</h4>
              {system
                .filter((s) => s.group === g)
                .map((s) => {
                  const takenBy = byKey.get(s.key)
                  return (
                    <div key={`${s.key}-${s.label}`} className={`shortcut ${takenBy ? 'taken' : ''}`}>
                      <span className="shortcut-keys">
                        <KeyCap k={keyLabel(s.key)} />
                      </span>
                      <span>
                        {s.label}
                        {takenBy && <span className="note"> — now {takenBy.name}</span>}
                      </span>
                    </div>
                  )
                })}
              {g === 'Review' && (
                <div className="shortcut">
                  <span className="shortcut-keys">
                    <KeyCap k="⌘Z" />
                  </span>
                  <span>Undo</span>
                </div>
              )}
              {g === 'Photo & window' && (
                <>
                  <div className="shortcut">
                    <span className="shortcut-keys">
                      <KeyCap k="⌘O" />
                    </span>
                    <span>Open a folder</span>
                  </div>
                  <div className="shortcut">
                    <span className="shortcut-keys">
                      <KeyCap k="⌘L" />
                    </span>
                    <span>Switch library</span>
                  </div>
                </>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

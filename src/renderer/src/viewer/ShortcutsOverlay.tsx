import { STATUS_LABELS } from '@shared/labels'
import { KeyCap } from '../components/KeyCap'

export interface ShortcutGroup {
  title: string
  items: { keys: string[]; label: string }[]
}

export const CORE_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Review',
    items: [
      { keys: ['↑'], label: `Like ${STATUS_LABELS.like.emoticon}` },
      { keys: ['↓'], label: `Meh ${STATUS_LABELS.meh.emoticon}` },
      { keys: ['←', '→'], label: 'Previous / next photo' },
      { keys: ['U'], label: 'Clear the mark' },
      { keys: ['⌘Z'], label: 'Undo' },
      { keys: ['Home', 'End'], label: 'First / last photo' }
    ]
  },
  {
    title: 'View',
    items: [
      { keys: ['1', '2', '3', '4'], label: 'All / Unreviewed / Like / Meh' },
      { keys: ['S'], label: 'Order: filename → date → random' },
      { keys: ['R'], label: 'Reshuffle (random order)' },
      { keys: ['G'], label: 'Go to folder' },
      { keys: ['Space'], label: 'Zoom to 100% (drag to pan)' }
    ]
  },
  {
    title: 'Photo & window',
    items: [
      { keys: ['C'], label: 'Copy full path' },
      { keys: ['O'], label: 'Show in Finder' },
      { keys: ['F'], label: 'Full screen' },
      { keys: ['H'], label: 'Hide / show toolbars' },
      { keys: ['⌘O'], label: 'Open a folder' },
      { keys: ['⌘L'], label: 'Switch library' },
      { keys: ['?'], label: 'This list' }
    ]
  }
]

export function ShortcutsOverlay({ extra, onClose }: { extra: ShortcutGroup['items']; onClose: () => void }) {
  const groups = extra.length ? [...CORE_SHORTCUTS, { title: 'Duplicates', items: extra }] : CORE_SHORTCUTS
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
          {groups.map((g) => (
            <section key={g.title}>
              <h4>{g.title}</h4>
              {g.items.map((it) => (
                <div key={it.label} className="shortcut">
                  <span className="shortcut-keys">
                    {it.keys.map((k) => (
                      <KeyCap key={k} k={k} />
                    ))}
                  </span>
                  <span>{it.label}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

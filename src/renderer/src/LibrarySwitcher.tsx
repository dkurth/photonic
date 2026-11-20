import { useEffect, useState } from 'react'
import type { Library } from '@shared/types'
import { Button } from './components/Button'

/** ⌘L / click the library name: switch between libraries or open a new folder. */
export function LibrarySwitcher({
  currentId,
  onOpen,
  onOpenFolder,
  onClose
}: {
  currentId: number | null
  onOpen: (id: number) => void
  onOpenFolder: () => void
  onClose: () => void
}) {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [sel, setSel] = useState(0)
  useEffect(() => {
    void window.photonic.libraries.list().then((ls) => {
      setLibraries(ls)
      setSel(
        Math.max(
          0,
          ls.findIndex((l) => l.id === currentId)
        )
      )
    })
  }, [currentId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, libraries.length - 1))
      else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0))
      else if (e.key === 'Enter' && libraries[sel]) onOpen(libraries[sel].id)
      else if (e.key === 'Escape') onClose()
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [libraries, onClose, onOpen, sel])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label="Switch library" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title pixel">LIBRARIES</div>
        <div className="folder-list" role="listbox">
          {libraries.map((l, i) => (
            <div
              key={l.id}
              role="option"
              aria-selected={i === sel}
              className={`folder-item library-item ${i === sel ? 'selected' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => onOpen(l.id)}
            >
              <span className="folder-name">
                <strong>{l.name}</strong>
                {l.id === currentId && <span className="note"> · open</span>}
              </span>
              <span className="mono">{l.rootPath}</span>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <Button size="small" variant="accent" keys={['⌘O']} onClick={onOpenFolder}>
            Open a folder…
          </Button>
        </div>
      </div>
    </div>
  )
}

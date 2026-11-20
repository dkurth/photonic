import { useEffect, useMemo, useRef, useState } from 'react'
import type { FolderInfo } from '@shared/types'
import { fmtNumber } from './format'

interface Item extends FolderInfo {
  label: string
  depth: number
}

/** Every space-separated term must appear in the path (case-insensitive). */
export function matchesQuery(dirPath: string, query: string): boolean {
  const hay = dirPath.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t))
}

/** `G`: choose the whole library or one folder (with its subfolders) to view (PLAN.md §7). */
export function FolderPicker({
  libraryId,
  current,
  onPick,
  onClose
}: {
  libraryId: number
  current: string | null
  onPick: (dirPath: string | null) => void
  onClose: () => void
}) {
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [whole, setWhole] = useState<FolderInfo>({ dirPath: '', total: 0, unreviewed: 0 })
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.photonic.libraries.folders(libraryId).then(setFolders)
    void window.photonic.photos
      .counts(libraryId, { kind: 'library' })
      .then((c) => setWhole({ dirPath: '', total: c.total, unreviewed: c.unreviewed }))
  }, [libraryId])

  const items: Item[] = useMemo(() => {
    const q = query.trim()
    const list: Item[] = folders
      .filter((f) => !q || matchesQuery(f.dirPath, q))
      .map((f) => ({
        ...f,
        depth: q ? 0 : f.dirPath.split('/').length - 1,
        label: q ? f.dirPath : f.dirPath.slice(f.dirPath.lastIndexOf('/') + 1)
      }))
    return q ? list : [{ ...whole, label: 'Entire library', depth: 0 }, ...list]
  }, [folders, query, whole])

  // Start on the current scope.
  useEffect(() => {
    if (query) return
    const i = items.findIndex((it) =>
      current === null ? it.dirPath === '' && it.label === 'Entire library' : it.dirPath === current
    )
    if (i >= 0) setSel(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const pick = (it: Item | undefined): void => {
    if (!it) return
    onPick(it.label === 'Entire library' && it.dirPath === '' ? null : it.dirPath)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal folder-picker"
        role="dialog"
        aria-label="Go to folder"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title pixel">GO TO FOLDER</div>
        <input
          autoFocus
          className="search"
          placeholder="Type to search folders…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSel(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, items.length - 1))
            else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0))
            else if (e.key === 'Enter') pick(items[sel])
            else if (e.key === 'Escape') onClose()
            else return
            e.preventDefault()
            e.stopPropagation()
          }}
        />
        <div className="folder-list" ref={listRef} role="listbox">
          {items.map((it, i) => (
            <div
              key={`${it.label}:${it.dirPath}`}
              role="option"
              aria-selected={i === sel}
              className={`folder-item ${i === sel ? 'selected' : ''}`}
              style={{ paddingLeft: 12 + it.depth * 18 }}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(it)}
            >
              <span className="folder-name">{it.label}</span>
              <span className="folder-counts">
                <span className="pixel">{fmtNumber(it.unreviewed)}</span> left of {fmtNumber(it.total)}
              </span>
            </div>
          ))}
          {items.length === 0 && <div className="folder-empty">No folders match.</div>}
        </div>
      </div>
    </div>
  )
}

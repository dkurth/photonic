import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Library, PhotoMeta, ScanPhase, ScanProgress, ViewSpec } from '@shared/types'
import { useKeyboard } from '../hooks/useKeyboard'
import { usePressed } from '../hooks/usePressed'
import { fmtNumber } from './format'
import { InfoBar } from './InfoBar'
import { PhotoCache } from './photoCache'
import { Stage } from './Stage'
import { Toolbar } from './Toolbar'
import { TopBar } from './TopBar'

export const defaultView = (libraryId: number): ViewSpec => ({
  libraryId,
  scope: { kind: 'library' },
  filter: 'unreviewed',
  sort: 'filename'
})

const viewKey = (libraryId: number): string => `view.${libraryId}`
const posKey = (libraryId: number): string => `pos.${libraryId}`

export function Viewer({
  library,
  progress,
  onOpenFolder
}: {
  library: Library
  progress: ScanProgress | null
  onOpenFolder: () => void
}) {
  const api = window.photonic
  const cache = useMemo(() => new PhotoCache(), [])
  const [view, setView] = useState<ViewSpec | null>(null)
  const [ids, setIds] = useState<number[]>([])
  const [index, setIndex] = useState(0)
  const [meta, setMeta] = useState<PhotoMeta | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [pressed, press] = usePressed()

  const currentId = ids[index] as number | undefined
  const currentIdRef = useRef(currentId)
  currentIdRef.current = currentId

  // --- Loading the list -------------------------------------------------------------------

  /** Rebuilds the list for `v`, staying on `keepId` if it's still there. */
  const loadList = useCallback(
    async (v: ViewSpec, keepId: number | undefined, fallbackIndex: number) => {
      const list = await api.photos.listIds(v)
      cache.clear()
      setIds(list)
      const i = keepId === undefined ? -1 : list.indexOf(keepId)
      setIndex(i >= 0 ? i : Math.max(0, Math.min(fallbackIndex, list.length - 1)))
    },
    [api, cache]
  )

  // Open: restore this library's view and position.
  useEffect(() => {
    let live = true
    void (async () => {
      const saved = await api.settings.get<ViewSpec>(viewKey(library.id))
      const last = (await api.settings.get<number>(posKey(library.id))) ?? undefined
      let v = saved ? { ...saved, libraryId: library.id } : defaultView(library.id)
      let list: number[]
      try {
        list = await api.photos.listIds(v)
      } catch {
        v = defaultView(library.id) // e.g. a filter from a feature that has since been turned off
        list = await api.photos.listIds(v)
      }
      if (!live) return
      cache.clear()
      setView(v)
      setIds(list)
      const i = last === undefined ? -1 : list.indexOf(last)
      setIndex(Math.max(0, i))
    })()
    return () => {
      live = false
    }
  }, [api, cache, library.id])

  // Rescans: rebuild the list when a scan phase ends (and while the list is still empty).
  const lastPhase = useRef<ScanPhase | null>(null)
  useEffect(() => {
    if (!view || !progress || progress.libraryId !== library.id) return
    const phaseChanged = progress.phase !== lastPhase.current
    lastPhase.current = progress.phase
    if (phaseChanged || ids.length === 0) void loadList(view, currentIdRef.current, index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress])

  // --- Current photo + neighbors -----------------------------------------------------------

  useEffect(() => {
    if (currentId === undefined) {
      setMeta(null)
      return
    }
    let live = true
    void cache.get(currentId).then((m) => {
      if (!live) return
      setMeta(m)
      const near = [ids[index + 1], ids[index + 2], ids[index - 1]].filter((x): x is number => x !== undefined)
      cache.keepImages([currentId, ...near])
      for (const id of near) void cache.get(id).then((n) => n && cache.preload(n))
    })
    return () => {
      live = false
    }
  }, [cache, currentId, ids, index])

  // Remember the position. Saved immediately (a SQLite upsert is microseconds): a debounce would
  // lose the last move if the app quits right after it.
  useEffect(() => {
    if (currentId !== undefined) void api.settings.set(posKey(library.id), currentId)
  }, [api, currentId, library.id])

  // --- Actions -----------------------------------------------------------------------------

  const go = useCallback((i: number) => setIndex(Math.max(0, Math.min(i, ids.length - 1))), [ids.length])

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1200)
  }, [])

  const copyPath = useCallback(() => {
    if (currentId === undefined) return
    press('copy')
    void api.photos.copyPath(currentId).then(() => flash('Path copied'))
  }, [api, currentId, flash, press])

  const reveal = useCallback(() => {
    if (currentId === undefined) return
    press('reveal')
    void api.photos.revealInFinder(currentId)
  }, [api, currentId, press])

  useKeyboard({
    ArrowRight: () => (press('next'), go(index + 1)),
    ArrowLeft: () => (press('prev'), go(index - 1)),
    Home: () => go(0),
    End: () => go(ids.length - 1),
    c: copyPath,
    o: reveal
  })

  // --- Render ------------------------------------------------------------------------------

  let empty: string | null = null
  if (!ids.length) {
    if (progress?.libraryId === library.id && progress.phase === 'walking') {
      empty = `Scanning… ${fmtNumber(progress.found)} photos found`
    } else if (view) {
      empty = view.filter === 'unreviewed' ? 'Nothing left to review here.' : 'No photos in this view.'
    }
  }

  return (
    <div className="viewer">
      <TopBar library={library} progress={progress} onOpenFolder={onOpenFolder} />
      <Stage meta={currentId === undefined ? null : meta?.id === currentId ? meta : meta} empty={empty} />
      <InfoBar meta={meta} pressed={pressed} onCopy={copyPath} onReveal={reveal} />
      <Toolbar
        index={index}
        total={ids.length}
        pressed={pressed}
        onPrev={() => go(index - 1)}
        onNext={() => go(index + 1)}
      />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}

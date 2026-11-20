import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Filter,
  Library,
  PhotoMeta,
  Playlist,
  PlaylistId,
  ScanPhase,
  ScanProgress,
  StatusCounts,
  ViewSpec
} from '@shared/types'
import { useKeyboard, type KeyHandler } from '../hooks/useKeyboard'
import { usePressed } from '../hooks/usePressed'
import { DoneScreen } from './DoneScreen'
import { FolderMarkDialog } from './FolderMarkDialog'
import { ManagePlaylists } from './ManagePlaylists'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { fmtNumber } from './format'
import { InfoBar } from './InfoBar'
import { firstUnreviewed, jumpsToUnreviewed, nextAfterMark } from './navigation'
import { PhotoCache } from './photoCache'
import { systemShortcuts } from './shortcuts'
import { Stage, type Flash } from './Stage'
import { Toolbar } from './Toolbar'
import { TopBar } from './TopBar'
import { filterPlaylistId, FILTERS, nextSort, SORT_LABELS, ViewControls } from './ViewControls'
import type { FeatureContext, RendererFeature } from '../features/types'

export const defaultView = (libraryId: number): ViewSpec => ({
  libraryId,
  filter: 'unreviewed',
  sort: 'filename'
})

const viewKey = (libraryId: number): string => `view.${libraryId}`
const posKey = (libraryId: number): string => `pos.${libraryId}`
const seedKey = (libraryId: number): string => `seed.${libraryId}`
const newSeed = (): number => Math.floor(Math.random() * 2 ** 31)

export function Viewer({
  library,
  progress,
  features,
  onOpenFolder,
  onSwitchLibrary
}: {
  library: Library
  progress: ScanProgress | null
  /** UI of the optional features that are turned on. */
  features: RendererFeature[]
  onOpenFolder: () => void
  onSwitchLibrary: () => void
}) {
  const api = window.photonic
  const cache = useMemo(() => new PhotoCache(), [])
  const [view, setView] = useState<ViewSpec | null>(null)
  const [ids, setIds] = useState<number[]>([])
  /** Each listed photo's playlist (null = unreviewed), same order as `ids`. */
  const [marks, setMarks] = useState<PlaylistId[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [index, setIndex] = useState(0)
  const [meta, setMeta] = useState<PhotoMeta | null>(null)
  /** The photos most likely to come next, kept decoded in the stage so they show instantly. */
  const [standby, setStandby] = useState<PhotoMeta[]>([])
  const [counts, setCounts] = useState<StatusCounts | null>(null)
  const [done, setDone] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<'filter' | 'playlists' | null>(null)
  const [managing, setManaging] = useState(false)
  const [featureModal, setFeatureModal] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [folderDialog, setFolderDialog] = useState(false)
  const [hudHidden, setHudHidden] = useState(false)
  const [zoomed, setZoomed] = useState(false)

  const filters = useMemo(() => [...FILTERS, ...features.flatMap((f) => f.filters ?? [])], [features])
  const system = useMemo(() => systemShortcuts(filters, features), [filters, features])
  const [pressed, press] = usePressed()

  const currentId = ids[index] as number | undefined
  const currentIdRef = useRef(currentId)
  currentIdRef.current = currentId
  const playlistById = useMemo(() => new Map(playlists.map((p) => [p.id, p])), [playlists])

  const refreshCounts = useCallback(
    (v: ViewSpec | null) => {
      if (v) void api.photos.counts(v.libraryId).then(setCounts)
    },
    [api]
  )

  // --- Loading the list -------------------------------------------------------------------

  /** Rebuilds the list for `v`, staying on the current photo if it's still in it. */
  const loadList = useCallback(
    async (v: ViewSpec, fallbackIndex: number) => {
      const list = await api.photos.list(v)
      // Stay on whatever photo is current *now* — the user may have moved while the list loaded.
      const keepId = currentIdRef.current
      cache.clear()
      setIds(list.ids)
      setMarks(list.playlists)
      const i = keepId === undefined ? -1 : list.ids.indexOf(keepId)
      setIndex(i >= 0 ? i : Math.max(0, Math.min(fallbackIndex, list.ids.length - 1)))
      refreshCounts(v)
    },
    [api, cache, refreshCounts]
  )

  // Open: restore this library's view and position.
  useEffect(() => {
    let live = true
    void (async () => {
      const saved = await api.settings.get<ViewSpec>(viewKey(library.id))
      const last = (await api.settings.get<number>(posKey(library.id))) ?? undefined
      let v = saved ? { ...saved, libraryId: library.id } : defaultView(library.id)
      let list
      try {
        list = await api.photos.list(v)
      } catch {
        v = defaultView(library.id) // e.g. a filter from a feature that has since been turned off
        list = await api.photos.list(v)
      }
      if (!live) return
      cache.clear()
      setView(v)
      setIds(list.ids)
      setMarks(list.playlists)
      setIndex(Math.max(0, last === undefined ? -1 : list.ids.indexOf(last)))
      refreshCounts(v)
    })()
    return () => {
      live = false
    }
  }, [api, cache, library.id, refreshCounts])

  // Playlists (shared by all libraries). They change from Manage Playlists, possibly moving photos.
  const viewRef = useRef(view)
  viewRef.current = view
  useEffect(() => {
    const refresh = async (): Promise<void> => {
      const list = await api.playlists.list()
      setPlaylists(list)
      const v = viewRef.current
      if (!v) return
      const viewing = filterPlaylistId(v.filter)
      if (viewing !== null && !list.some((p) => p.id === viewing)) {
        // The playlist being viewed was deleted.
        const next = { ...v, filter: 'unreviewed' }
        setView(next)
        void api.settings.set(viewKey(library.id), next)
        await loadList(next, 0)
      } else {
        await loadList(v, 0)
      }
    }
    void api.playlists.list().then(setPlaylists)
    return api.playlists.onChanged(() => void refresh())
  }, [api, library.id, loadList])

  // Rescans: rebuild the list when a scan phase ends (and while the list is still empty).
  const lastPhase = useRef<ScanPhase | null>(null)
  useEffect(() => {
    if (!view || !progress || progress.libraryId !== library.id) return
    const phaseChanged = progress.phase !== lastPhase.current
    lastPhase.current = progress.phase
    if (phaseChanged || ids.length === 0) void loadList(view, index)
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
      // Where marking would go next, the one after that, and ←/→. (Looking further ahead was
      // measured to be no faster: the extra decodes compete with the one that's needed next.)
      const jump = view ? nextAfterMark(marks, index, view.filter) : null
      const near = [
        ...new Set([jump === null ? undefined : ids[jump], ids[index + 1], ids[index + 2], ids[index - 1]])
      ].filter((x): x is number => x !== undefined)
      void Promise.all(near.map((id) => cache.get(id))).then((ms) => {
        if (live) setStandby(ms.filter((x): x is PhotoMeta => !!x && !x.missing))
      })
    })
    return () => {
      live = false
    }
    // marks only matter for picking what to preload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, currentId, ids, index, view])

  // Remember the position. Saved immediately (a SQLite upsert is microseconds): a debounce would
  // lose the last move if the app quits right after it.
  useEffect(() => {
    if (currentId !== undefined) void api.settings.set(posKey(library.id), currentId)
  }, [api, currentId, library.id])

  // --- Actions -----------------------------------------------------------------------------

  const flashToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1400)
  }, [])

  const go = useCallback(
    (i: number) => {
      setDone(false)
      setIndex(Math.max(0, Math.min(i, ids.length - 1)))
    },
    [ids.length]
  )

  const next = useCallback(() => {
    if (index >= ids.length - 1) setDone(ids.length > 0)
    else go(index + 1)
  }, [go, ids.length, index])

  const prev = useCallback(() => {
    if (done) setDone(false)
    else go(index - 1)
  }, [done, go, index])

  /**
   * Puts the current photo in a playlist (null = back to Unreviewed). Updates the screen first,
   * then saves (PLAN.md §9); putting it in a playlist moves on like ↑/↓ always have.
   */
  const mark = useCallback(
    async (playlistId: PlaylistId) => {
      if (currentId === undefined || !view || done) return
      const i = index
      const before = marks[i]
      const updated = [...marks]
      updated[i] = playlistId
      setMarks(updated)
      // Update the cached copy too: rendering reads it (cache.peek) to switch photos instantly.
      const cur = cache.peek(currentId) ?? (meta?.id === currentId ? meta : null)
      if (cur) {
        const m = { ...cur, playlistId }
        cache.set(m)
        setMeta(m)
      }
      setFlash((f) => {
        const n = (f?.n ?? 0) + 1
        window.setTimeout(() => setFlash((c) => (c?.n === n ? null : c)), 900)
        return { playlistId, n }
      })

      if (playlistId !== null) {
        const j = nextAfterMark(updated, i, view.filter)
        if (j === null) setDone(true)
        else setIndex(j)
      }

      try {
        const saved = await api.marks.set(currentId, playlistId)
        if (saved) cache.set(saved)
        refreshCounts(view)
      } catch (e) {
        // Put it back the way it was.
        setMarks((s) => {
          const r = [...s]
          r[i] = before
          return r
        })
        cache.invalidate(currentId)
        flashToast(`Couldn't save: ${String(e)}`)
      }
    },
    [api, cache, currentId, done, flashToast, index, marks, meta, refreshCounts, view]
  )

  // ⌘Z: the page handles the key (and prevents the default, so the Edit → Undo menu accelerator
  // doesn't also fire); choosing Edit → Undo with the mouse sends the 'undo' menu command instead.
  const undo = useCallback(async () => {
    const r = await api.marks.undo(library.id)
    if (!r) {
      flashToast('Nothing to undo')
      return
    }
    const label = r.changes.length > 1 ? `Undid ${fmtNumber(r.changes.length)} changes` : 'Undone'
    // Un-hiding brings photos back into the view: rebuild the list, staying on the current photo.
    if (r.changes.some((c) => c.field === 'hidden')) {
      setDone(false)
      if (view) await loadList(view, index)
      flashToast(label)
      return
    }
    const pos = new Map(ids.map((id, i) => [id, i]))
    setMarks((s) => {
      const u = [...s]
      for (const c of r.changes) {
        const i = pos.get(c.photoId)
        if (i !== undefined && c.field === 'playlist') u[i] = c.playlistId
      }
      return u
    })
    for (const c of r.changes) cache.invalidate(c.photoId)
    // Go back to the photo that changed (the first one in list order, for a batch).
    const target = r.changes
      .map((c) => pos.get(c.photoId))
      .filter((i): i is number => i !== undefined)
      .sort((a, b) => a - b)[0]
    setDone(false)
    if (target !== undefined) {
      setIndex(target)
      if (target === index && currentId !== undefined) void cache.get(currentId).then(setMeta)
    }
    flashToast(label)
    refreshCounts(view)
  }, [api, cache, currentId, flashToast, ids, index, library.id, loadList, refreshCounts, view])

  // --- Changing the view (PLAN.md §7) -----------------------------------------------------

  /** Random order keeps one seed per library, so its shuffle is stable across restarts. */
  const seedFor = useCallback(
    async (fresh = false): Promise<number> => {
      const saved = await api.settings.get<number>(seedKey(library.id))
      if (!fresh && saved !== null) return saved
      const seed = newSeed()
      await api.settings.set(seedKey(library.id), seed)
      return seed
    },
    [api, library.id]
  )

  const changeView = useCallback(
    async (patch: Partial<ViewSpec>, opts: { freshSeed?: boolean } = {}) => {
      if (!view) return
      const v: ViewSpec = { ...view, ...patch, libraryId: library.id }
      if (v.sort === 'random') v.seed = await seedFor(opts.freshSeed)
      else delete v.seed
      setView(v)
      setDone(false)
      void api.settings.set(viewKey(library.id), v)
      await loadList(v, 0)
    },
    [api, library.id, loadList, seedFor, view]
  )

  const setFilter = useCallback((filter: Filter) => void changeView({ filter }), [changeView])

  const cycleSort = useCallback(() => {
    if (!view) return
    press('sort')
    const sort = nextSort(view.sort)
    void changeView({ sort }).then(() => flashToast(`Order: ${SORT_LABELS[sort]}`))
  }, [changeView, flashToast, press, view])

  const reshuffle = useCallback(() => {
    if (view?.sort !== 'random') return
    void changeView({}, { freshSeed: true }).then(() => flashToast('Reshuffled'))
  }, [changeView, flashToast, view])

  const copyPath = useCallback(() => {
    if (currentId === undefined) return
    press('copy')
    void api.photos.copyPath(currentId).then(() => flashToast('Path copied'))
  }, [api, currentId, flashToast, press])

  const reveal = useCallback(() => {
    if (currentId === undefined) return
    press('reveal')
    void api.photos.revealInFinder(currentId)
  }, [api, currentId, press])

  const unreviewedEarlier = done && view && jumpsToUnreviewed(view.filter) ? marks.filter((m) => m === null).length : 0

  // --- Keys ----------------------------------------------------------------------------------

  const keysEnabled = !featureModal && !shortcutsOpen && !openMenu && !folderDialog && !managing

  // The app's own keys (see shortcuts.ts for the list shown to the user).
  useKeyboard(
    {
      ArrowRight: () => (press('next'), next()),
      ArrowLeft: () => (press('prev'), prev()),
      // Marking keys ignore key repeat, so a held key can't mark a whole folder (PLAN.md §2).
      Backspace: (e) => !e.repeat && void mark(null),
      u: (e) => !e.repeat && void mark(null),
      'Mod+z': () => void undo(),
      Home: () => (press('first'), go(0)),
      End: () => (press('last'), go(ids.length - 1)),
      Escape: () => (setDone(false), setZoomed(false)),
      Enter: () => {
        if (!done) return
        const f = firstUnreviewed(marks)
        if (f >= 0) go(f)
      },
      c: copyPath,
      o: reveal,
      s: cycleSort,
      r: reshuffle,
      h: () => setHudHidden((x) => !x),
      f: () => setFolderDialog(true),
      ' ': () => setZoomed((z) => !z),
      '?': () => setShortcutsOpen(true),
      // 1 All, 2 Unreviewed, then filters added by features (3 = Duplicates)
      ...Object.fromEntries(filters.map((f) => [f.key, () => setFilter(f.id)]))
    },
    keysEnabled
  )

  // Playlist keys run first (capture phase), so a playlist can take over one of the app's keys.
  const playlistKeys = useMemo(
    () =>
      Object.fromEntries(
        playlists
          .filter((p) => p.shortcut)
          .map((p): [string, KeyHandler] => [p.shortcut!, (e) => !e.repeat && (press(`pl-${p.id}`), void mark(p.id))])
      ),
    [mark, playlists, press]
  )
  useKeyboard(playlistKeys, keysEnabled, { capture: true })

  useKeyboard({ Escape: () => setShortcutsOpen(false), '?': () => setShortcutsOpen(false) }, shortcutsOpen)

  // Menu commands. Undo goes to a focused text field if there is one, otherwise it undoes a mark.
  const undoRef = useRef(undo)
  undoRef.current = undo
  useEffect(
    () =>
      api.onMenu((cmd) => {
        if (cmd === 'shortcuts') setShortcutsOpen(true)
        if (cmd === 'undo') {
          const el = document.activeElement
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) document.execCommand('undo')
          else void undoRef.current()
        }
      }),
    [api]
  )

  const reload = useCallback(async () => {
    if (view) await loadList(view, index)
  }, [index, loadList, view])

  // If the next photo's details are already here (they usually are), show it in this very render
  // instead of waiting for the effect above.
  const shown = (currentId !== undefined ? cache.peek(currentId) : undefined) ?? (meta?.id === currentId ? meta : null)
  const shownPlaylist = shown?.playlistId != null ? (playlistById.get(shown.playlistId) ?? null) : null

  const featureCtx: FeatureContext | null = view
    ? {
        libraryId: library.id,
        view,
        meta: shown,
        playlists,
        progress,
        setFilter,
        reload,
        toast: flashToast,
        setModalOpen: setFeatureModal
      }
    : null

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
    <div className={`viewer ${hudHidden ? 'hud-hidden' : ''}`}>
      <TopBar
        library={library}
        progress={progress}
        onOpenFolder={onOpenFolder}
        onSwitchLibrary={onSwitchLibrary}
        controls={
          view && (
            <ViewControls
              view={view}
              filters={filters}
              playlists={playlists}
              counts={counts}
              openMenu={openMenu}
              onOpenMenu={setOpenMenu}
              pressed={pressed}
              onFilter={setFilter}
              onManagePlaylists={() => setManaging(true)}
              onSort={cycleSort}
            />
          )
        }
      />
      <Stage
        meta={shown}
        standby={standby}
        empty={empty}
        zoomed={zoomed}
        overlay={
          done ? <DoneScreen counts={counts} playlists={playlists} unreviewedEarlier={unreviewedEarlier} /> : null
        }
      />
      <InfoBar
        meta={shown}
        playlist={shownPlaylist}
        pressed={pressed}
        onCopy={copyPath}
        onReveal={reveal}
        badges={featureCtx && features.map((f) => f.InfoBadge && <f.InfoBadge key={f.name} ctx={featureCtx} />)}
      />
      <Toolbar
        index={index}
        total={ids.length}
        pressed={pressed}
        counts={counts}
        canMark={currentId !== undefined && !done}
        arrowPlaylists={{
          down: playlists.find((p) => p.shortcut === 'ArrowDown'),
          up: playlists.find((p) => p.shortcut === 'ArrowUp')
        }}
        flash={flash}
        onFirst={() => (press('first'), go(0))}
        onPrev={() => (press('prev'), prev())}
        onNext={() => (press('next'), next())}
        onLast={() => (press('last'), go(ids.length - 1))}
        onMark={(id) => void mark(id)}
      />
      {featureCtx && features.map((f) => f.Layer && <f.Layer key={f.name} ctx={featureCtx} />)}
      {folderDialog && (
        <FolderMarkDialog
          libraryId={library.id}
          playlists={playlists}
          initialPath={shown ? shown.absPath.slice(0, shown.absPath.lastIndexOf('/')) : library.rootPath}
          onClose={() => setFolderDialog(false)}
          onDone={({ changed, playlist }) => {
            setFolderDialog(false)
            setDone(false)
            void reload()
            flashToast(
              changed
                ? `Put ${fmtNumber(changed)} ${changed === 1 ? 'photo' : 'photos'} in ${playlist.name} — ⌘Z to undo`
                : 'Nothing to change'
            )
          }}
        />
      )}
      {managing && <ManagePlaylists playlists={playlists} system={system} onClose={() => setManaging(false)} />}
      {shortcutsOpen && (
        <ShortcutsOverlay system={system} playlists={playlists} onClose={() => setShortcutsOpen(false)} />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}

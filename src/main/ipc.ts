import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { isAbsolute } from 'node:path'
import type { AppInfo, ExportNaming, Library, ScanProgress, ViewSpec } from '@shared/types'
import type { DB } from './db'
import { schemaVersion } from './db'
import { listBackups } from './db/backup'
import type { FeatureRegistry } from './features/registry'
import type { IpcRegistrar } from './features/types'
import { addLibrary, getLibraryRow, libraryStats, listLibraries, toLibrary } from './library'
import { exportSources, runExport } from './export'
import { markFolder, resolveFolder } from './folderMarks'
import { setPlaylist, undoLast } from './marks'
import {
  builtinId,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  renamePlaylist,
  resetShortcuts,
  setShortcut
} from './playlists'
import { listIds, listPhotos, statusCounts } from './ordering'
import { getPhotoRow, toPhotoMeta } from './photos'
import { ensureMetadata, type Extractor } from './scanner/metadata'
import type { ScanService } from './scanner/service'
import { getSetting, setSetting } from './settings'
import { readUi } from './ui'

export const handle: IpcRegistrar = (channel, handler) => {
  ipcMain.handle(channel, (_event, ...args) => handler(...args))
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) throw new Error(`Invalid ${what}`)
  return v
}

/** Checks the shape of a ViewSpec coming from the renderer, keeping only known fields. */
function viewSpec(db: DB, v: unknown): ViewSpec {
  const o = v as ViewSpec
  if (!o || typeof o !== 'object') throw new Error('Invalid view')
  id(o.libraryId)
  if (!['filename', 'date', 'random'].includes(o.sort)) throw new Error('Invalid sort')
  let filter = str(o.filter, 'filter')
  // Views saved before playlists used 'like' / 'meh' as filters.
  if (filter === 'like' || filter === 'meh') filter = `playlist:${builtinId(db, filter)}`
  if (o.seed !== undefined && !Number.isSafeInteger(o.seed)) throw new Error('Invalid seed')
  return { libraryId: o.libraryId, filter, sort: o.sort, seed: o.seed }
}

/** A playlist id from the renderer (null = Unreviewed) that must exist. */
function playlistArg(db: DB, v: unknown, allowNull: boolean): number | null {
  if (v === null && allowNull) return null
  const pid = id(v)
  if (!getPlaylist(db, pid)) throw new Error(`Playlist ${pid} not found`)
  return pid
}

function broadcastPlaylistsChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('playlists:changed')
}

/** IPC arguments come from the renderer; never trust their shape. */
function id(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new Error(`Invalid id: ${String(v)}`)
  return v
}

export function broadcastProgress(p: ScanProgress): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('libraries:progress', p)
}

const LAST_LIBRARY = 'app.lastLibraryId'

export function registerCoreIpc(ctx: {
  db: DB
  dbPath: string
  backupDir: string
  features: FeatureRegistry
  scans: ScanService
  extract: Extractor
}): void {
  const { db, scans } = ctx
  const vis = { hideReasons: ctx.features.hideReasons() }

  /** Opens a library: remembers it and starts a scan in the background. */
  function open(libraryId: number): Library {
    const row = getLibraryRow(db, libraryId)
    if (!row) throw new Error(`Library ${libraryId} not found`)
    setSetting(db, LAST_LIBRARY, libraryId)
    scans.scan(libraryId).catch((err) => console.error('Scan failed:', err))
    return toLibrary(row)
  }

  handle('app:info', (): AppInfo => {
    const last = listBackups(ctx.backupDir).at(-1)
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      dbPath: ctx.dbPath,
      schemaVersion: schemaVersion(db),
      features: ctx.features.names(),
      lastBackup: last ? last.at.toISOString() : null
    }
  })

  handle('app:ui', () => readUi(db))

  handle('libraries:pickAndOpen', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = { title: 'Choose a photo folder', properties: ['openDirectory' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    return open(addLibrary(db, res.filePaths[0]).id)
  })

  handle('libraries:list', () => listLibraries(db))

  handle('libraries:open', (libraryId) => open(id(libraryId)))

  handle('libraries:last', () => {
    const last = getSetting<number>(db, LAST_LIBRARY)
    const row = last ? getLibraryRow(db, last) : null
    return row ? toLibrary(row) : null
  })

  handle('libraries:rescan', async (libraryId) => {
    await scans.scan(id(libraryId))
  })

  handle('libraries:stats', (libraryId) => libraryStats(db, id(libraryId), vis))

  handle('photos:listIds', (view) => listIds(db, viewSpec(db, view), ctx.features.filters(), vis))

  handle('photos:list', (view) => listPhotos(db, viewSpec(db, view), ctx.features.filters(), vis))

  handle('photos:counts', (libraryId) => statusCounts(db, id(libraryId), vis))

  handle('marks:set', (photoId, playlistId) => {
    const pid = id(photoId)
    if (!setPlaylist(db, pid, playlistArg(db, playlistId, true))) return null
    const row = getPhotoRow(db, pid)
    return row ? toPhotoMeta(row) : null
  })

  handle('marks:undo', (libraryId) => undoLast(db, id(libraryId)))

  handle('photos:get', async (photoId) => {
    const pid = id(photoId)
    await ensureMetadata(db, pid, ctx.extract).catch(() => {})
    const row = getPhotoRow(db, pid)
    return row ? toPhotoMeta(row) : null
  })

  handle('photos:revealInFinder', (photoId) => {
    const row = getPhotoRow(db, id(photoId))
    if (row) shell.showItemInFolder(toPhotoMeta(row).absPath)
  })

  handle('photos:copyPath', (photoId) => {
    const row = getPhotoRow(db, id(photoId))
    if (row) clipboard.writeText(toPhotoMeta(row).absPath)
  })

  handle('features:enabled', () => ctx.features.names())

  handle('folders:resolve', (libraryId, path) => {
    if (typeof path !== 'string' || path.length > 4096) throw new Error('Invalid path')
    return resolveFolder(db, id(libraryId), path, vis)
  })

  handle('folders:pick', async (libraryId) => {
    const lib = getLibraryRow(db, id(libraryId))
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: 'Choose a folder to Like or Meh',
      defaultPath: lib?.root_path,
      properties: ['openDirectory' as const]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  handle('folders:mark', (libraryId, dirPath, playlistId, mode) => {
    if (typeof dirPath !== 'string') throw new Error('Invalid folder')
    if (mode !== 'all' && mode !== 'unreviewed') throw new Error('Invalid mode')
    return markFolder(db, id(libraryId), dirPath, playlistArg(db, playlistId, false)!, mode, vis)
  })

  // Playlists (PLAN.md §12). Every change is broadcast so all views refresh their lists and keys.
  const changed = <T>(result: T): T => (broadcastPlaylistsChanged(), result)
  handle('playlists:list', () => listPlaylists(db))
  handle('playlists:create', (name) => changed(createPlaylist(db, str(name, 'name'))))
  handle('playlists:rename', (pid, name) => changed(renamePlaylist(db, id(pid), str(name, 'name'))))
  handle('playlists:setShortcut', (pid, key) => {
    if (key !== null && (typeof key !== 'string' || key.length === 0 || key.length > 20)) throw new Error('Invalid key')
    setShortcut(db, id(pid), key as string | null)
    return changed(listPlaylists(db))
  })
  handle('playlists:resetShortcuts', (systemKeys) => {
    if (!Array.isArray(systemKeys) || !systemKeys.every((k) => typeof k === 'string')) throw new Error('Invalid keys')
    resetShortcuts(db, systemKeys as string[])
    return changed(listPlaylists(db))
  })
  handle('playlists:remove', (pid, moveTo) => changed(deletePlaylist(db, id(pid), playlistArg(db, moveTo, true))))

  // Export (PLAN.md §15): copies a playlist's photos into one flat folder. One export at a time.
  const LAST_EXPORT_DIR = 'export.lastDir'
  let exporting: { cancelled: boolean } | null = null
  handle('exports:pickFolder', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: 'Choose where to copy the photos',
      buttonLabel: 'Choose',
      defaultPath: getSetting<string>(db, LAST_EXPORT_DIR) ?? app.getPath('pictures'),
      properties: ['openDirectory' as const, 'createDirectory' as const]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  handle(
    'exports:count',
    (playlistId) => exportSources(db, playlistArg(db, playlistId, false)!, vis.hideReasons).length
  )
  handle('exports:run', async (playlistId, destDir, naming) => {
    const pid = playlistArg(db, playlistId, false)!
    if (typeof destDir !== 'string' || !isAbsolute(destDir) || destDir.length > 4096) throw new Error('Invalid folder')
    if (!['original', 'sequential', 'date'].includes(naming as string)) throw new Error('Invalid naming')
    if (exporting) throw new Error('An export is already running')
    const job = (exporting = { cancelled: false })
    try {
      setSetting(db, LAST_EXPORT_DIR, destDir)
      const send = (p: unknown): void => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.send('exports:progress', p)
      }
      return await runExport(exportSources(db, pid, vis.hideReasons), destDir, naming as ExportNaming, {
        onProgress: send,
        isCancelled: () => job.cancelled
      })
    } finally {
      exporting = null
    }
  })
  handle('exports:cancel', () => {
    if (exporting) exporting.cancelled = true
  })
  handle('exports:reveal', async (destDir) => {
    if (typeof destDir !== 'string' || !isAbsolute(destDir)) throw new Error('Invalid folder')
    await shell.openPath(destDir)
  })

  handle('settings:get', (key) => getSetting(db, str(key, 'key')))
  handle('settings:set', (key, value) => setSetting(db, str(key, 'key'), value))
}

import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import type { AppInfo, Library, ScanProgress, Scope, ViewSpec } from '@shared/types'
import type { DB } from './db'
import { schemaVersion } from './db'
import { listBackups } from './db/backup'
import type { FeatureRegistry } from './features/registry'
import type { IpcRegistrar } from './features/types'
import { addLibrary, getLibraryRow, libraryStats, listFolders, listLibraries, toLibrary } from './library'
import { isStatus, setStatus, undoLast } from './marks'
import { listIds, listPhotos, statusCounts } from './ordering'
import { getPhotoRow, toPhotoMeta } from './photos'
import { ensureMetadata, type Extractor } from './scanner/metadata'
import type { ScanService } from './scanner/service'
import { getSetting, setSetting } from './settings'

export const handle: IpcRegistrar = (channel, handler) => {
  ipcMain.handle(channel, (_event, ...args) => handler(...args))
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 200) throw new Error(`Invalid ${what}`)
  return v
}

function scope(v: unknown): Scope {
  const o = v as Scope
  if (o?.kind === 'library') return { kind: 'library' }
  if (o?.kind === 'folder' && typeof o.dirPath === 'string') return { kind: 'folder', dirPath: o.dirPath }
  throw new Error('Invalid scope')
}

/** Checks the shape of a ViewSpec coming from the renderer. */
function viewSpec(v: unknown): ViewSpec {
  const o = v as ViewSpec
  if (!o || typeof o !== 'object') throw new Error('Invalid view')
  id(o.libraryId)
  if (!['filename', 'date', 'random'].includes(o.sort)) throw new Error('Invalid sort')
  str(o.filter, 'filter')
  scope(o.scope)
  if (o.seed !== undefined && !Number.isSafeInteger(o.seed)) throw new Error('Invalid seed')
  return o
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

  handle('libraries:stats', (libraryId) => libraryStats(db, id(libraryId)))

  handle('libraries:folders', (libraryId) => listFolders(db, id(libraryId)))

  handle('photos:listIds', (view) => listIds(db, viewSpec(view), ctx.features.filters()))

  handle('photos:list', (view) => listPhotos(db, viewSpec(view), ctx.features.filters()))

  handle('photos:counts', (libraryId, sc) => statusCounts(db, id(libraryId), scope(sc)))

  handle('marks:set', (photoId, status) => {
    if (!isStatus(status)) throw new Error('Invalid status')
    const pid = id(photoId)
    if (!setStatus(db, pid, status)) return null
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

  handle('settings:get', (key) => getSetting(db, str(key, 'key')))
  handle('settings:set', (key, value) => setSetting(db, str(key, 'key'), value))
}

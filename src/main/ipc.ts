import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { AppInfo, Library, ScanProgress } from '@shared/types'
import type { DB } from './db'
import { schemaVersion } from './db'
import { listBackups } from './db/backup'
import type { FeatureRegistry } from './features/registry'
import type { IpcRegistrar } from './features/types'
import { addLibrary, getLibraryRow, libraryStats, listLibraries, toLibrary } from './library'
import type { ScanService } from './scanner/service'
import { getSetting, setSetting } from './settings'

export const handle: IpcRegistrar = (channel, handler) => {
  ipcMain.handle(channel, (_event, ...args) => handler(...args))
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
}

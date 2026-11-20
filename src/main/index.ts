import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { migrate, openDatabase, type DB } from './db'
import { backupIfDue } from './db/backup'
import { coreMigrations } from './db/migrations'
import { createDedupeFeature } from './features/dedupe'
import { createWorkerHasher } from './features/dedupe/workerHasher'
import { FeatureRegistry } from './features/registry'
import { broadcastProgress, handle, registerCoreIpc } from './ipc'
import { buildMenu } from './menu'
import { handlePhotoProtocol, registerPhotoScheme } from './photoProtocol'
import { ScanService } from './scanner/service'
import { getSetting, setSetting } from './settings'
import { createWorkerExtractor } from './scanner/workerExtractor'

// Keep development data away from real data. PHOTONIC_USER_DATA overrides both (used by e2e tests).
if (process.env.PHOTONIC_USER_DATA) {
  app.setPath('userData', process.env.PHOTONIC_USER_DATA)
} else if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`)
}

registerPhotoScheme()

let db: DB | null = null
let scans: ScanService | null = null
let backupDone: Promise<void> = Promise.resolve()
let features: FeatureRegistry | null = null

const DEDUPE_FLAG = 'feature.dedupe'
/** Duplicate detection is on unless turned off (View menu). */
const dedupeEnabled = (d: DB): boolean => getSetting<boolean>(d, DEDUPE_FLAG) ?? true
const metadata = createWorkerExtractor()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#F4F1EA',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    title: 'Photonic',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Never navigate the app window away; open external links in the browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const dbPath = join(userData, 'photonic.db')
  const backupDir = join(userData, 'backups')

  db = openDatabase(dbPath)
  migrate(db, coreMigrations) // core first: feature flags live in the settings table

  // Optional features (PLAN.md §8). Each is one line; deleting it (and its folder) removes the feature.
  const registry = new FeatureRegistry()
  if (dedupeEnabled(db)) registry.register(createDedupeFeature(createWorkerHasher()))
  features = registry

  migrate(db, [...coreMigrations, ...registry.migrations()])
  backupDone = backupIfDue(db, backupDir).then(
    () => {},
    (err) => console.error('Backup failed:', err)
  )

  scans = new ScanService(db, {
    hooks: () => registry.scanHooks(),
    extract: metadata.extract,
    emit: broadcastProgress
  })

  registerCoreIpc({ db, dbPath, backupDir, features: registry, scans, extract: metadata.extract })
  handlePhotoProtocol(() => db)
  registry.registerIpc(handle, { db })
  buildMenu({ dedupe: dedupeEnabled(db), setDedupe: (on) => db && setSetting(db, DEDUPE_FLAG, on) })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Stop background work before closing the DB, so nothing writes to a closed connection.
// Ends with app.exit(): calling app.quit() again from inside the quit sequence can be ignored
// (it was, whenever the cleanup finished within the same tick).
let quitting = false
app.on('will-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  void (async () => {
    try {
      await scans?.cancel()
      await metadata.close()
      await features?.dispose()
      await backupDone
      db?.close()
      db = null
    } catch (err) {
      console.error('Error during shutdown:', err)
    } finally {
      app.exit(0)
    }
  })()
})

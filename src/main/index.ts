import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { migrate, openDatabase, type DB } from './db'
import { backupIfDue } from './db/backup'
import { coreMigrations } from './db/migrations'
import { FeatureRegistry } from './features/registry'
import { broadcastProgress, handle, registerCoreIpc } from './ipc'
import { ScanService } from './scanner/service'
import { createWorkerExtractor } from './scanner/workerExtractor'

// Keep development data away from real data. PHOTONIC_USER_DATA overrides both (used by e2e tests).
if (process.env.PHOTONIC_USER_DATA) {
  app.setPath('userData', process.env.PHOTONIC_USER_DATA)
} else if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`)
}

let db: DB | null = null
let scans: ScanService | null = null
const metadata = createWorkerExtractor()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#F4F1EA',
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

  const features = new FeatureRegistry()
  // Optional features register here (the dedupe feature arrives in M5).

  db = openDatabase(dbPath)
  migrate(db, [...coreMigrations, ...features.migrations()])
  backupIfDue(db, backupDir).catch((err) => console.error('Backup failed:', err))

  scans = new ScanService(db, {
    hooks: () => features.scanHooks(),
    extract: metadata.extract,
    emit: broadcastProgress
  })

  registerCoreIpc({ db, dbPath, backupDir, features, scans })
  features.registerIpc(handle)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Stop background work before closing the DB, so nothing writes to a closed connection.
let quitting = false
app.on('will-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  void (async () => {
    await scans?.cancel()
    await metadata.close()
    db?.close()
    db = null
    app.quit()
  })()
})

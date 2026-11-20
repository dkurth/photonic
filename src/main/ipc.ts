import { app, ipcMain } from 'electron'
import type { AppInfo } from '@shared/types'
import type { DB } from './db'
import { schemaVersion } from './db'
import { listBackups } from './db/backup'
import type { FeatureRegistry } from './features/registry'
import type { IpcRegistrar } from './features/types'

export const handle: IpcRegistrar = (channel, handler) => {
  ipcMain.handle(channel, (_event, ...args) => handler(...args))
}

export function registerCoreIpc(ctx: {
  db: DB
  dbPath: string
  backupDir: string
  features: FeatureRegistry
}): void {
  handle('app:info', (): AppInfo => {
    const last = listBackups(ctx.backupDir).at(-1)
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      dbPath: ctx.dbPath,
      schemaVersion: schemaVersion(ctx.db),
      features: ctx.features.names(),
      lastBackup: last ? last.at.toISOString() : null
    }
  })
}

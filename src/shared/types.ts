export type Status = 'unreviewed' | 'like' | 'meh'

export interface AppInfo {
  version: string
  electron: string
  dbPath: string
  schemaVersion: number
  features: string[]
  lastBackup: string | null
}

/** The API exposed to the renderer as `window.photonic` (see src/preload). Grows milestone by milestone. */
export interface PhotonicAPI {
  app: {
    info(): Promise<AppInfo>
  }
}

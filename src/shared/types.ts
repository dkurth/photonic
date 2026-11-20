export type Status = 'unreviewed' | 'like' | 'meh'

export interface AppInfo {
  version: string
  electron: string
  dbPath: string
  schemaVersion: number
  features: string[]
  lastBackup: string | null
}

export interface Library {
  id: number
  rootPath: string
  name: string
  addedAt: string
  lastScannedAt: string | null
}

export interface LibraryStats {
  /** Photos present on disk (missing ones excluded from every other count too). */
  total: number
  missing: number
  unreviewed: number
  like: number
  meh: number
  /** Photos whose EXIF has been read. */
  metaRead: number
  /** Photos with an EXIF capture date. */
  withTakenAt: number
  folders: number
}

export type ScanPhase = 'walking' | 'metadata' | 'done' | 'error'

export interface ScanProgress {
  libraryId: number
  phase: ScanPhase
  found: number
  added: number
  changed: number
  missing: number
  moved: number
  /** Folders that couldn't be read during the walk. */
  unreadableFolders: number
  metaDone: number
  metaTotal: number
  message?: string
}

export type Unsubscribe = () => void

/** The API exposed to the renderer as `window.photonic` (see src/preload). Grows milestone by milestone. */
export interface PhotonicAPI {
  app: {
    info(): Promise<AppInfo>
  }
  libraries: {
    /** Shows a folder picker; adds (or reuses) the library, opens it and starts a scan. */
    pickAndOpen(): Promise<Library | null>
    list(): Promise<Library[]>
    /** Opens a library (remembered for next launch) and starts a rescan. */
    open(id: number): Promise<Library>
    /** The library opened most recently, if it still exists. */
    last(): Promise<Library | null>
    rescan(id: number): Promise<void>
    stats(id: number): Promise<LibraryStats>
    onProgress(cb: (p: ScanProgress) => void): Unsubscribe
  }
}

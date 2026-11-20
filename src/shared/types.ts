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

export interface StatusCounts {
  total: number
  unreviewed: number
  like: number
  meh: number
}

/** A view's photo IDs with their statuses (same order), so the renderer can find the next unreviewed photo. */
export interface PhotoList {
  ids: number[]
  statuses: Status[]
}

export interface UndoResult {
  /** Photos whose status was restored, most recent change first. */
  changes: { photoId: number; status: Status }[]
}

export type SortOrder = 'filename' | 'date' | 'random'
export type Scope = { kind: 'library' } | { kind: 'folder'; dirPath: string }
/** Core filters; optional features may add more (e.g. 'duplicates'). */
export type Filter = 'all' | 'unreviewed' | 'like' | 'meh' | (string & {})

/** Everything that defines "the list of photos being viewed" (PLAN.md §7). */
export interface ViewSpec {
  libraryId: number
  scope: Scope
  filter: Filter
  sort: SortOrder
  /** Random order only: the same seed always gives the same order. */
  seed?: number
}

export type DateSource = 'taken' | 'created' | 'modified'

export interface PhotoMeta {
  id: number
  libraryId: number
  relPath: string
  dirPath: string
  absPath: string
  /** URL the renderer uses to display the image (photo:// protocol). */
  url: string
  status: Status
  /** 'YYYY-MM-DD HH:MM:SS' — EXIF capture time, else file creation, else modification time. */
  displayDate: string
  dateSource: DateSource
  sizeBytes: number
  width: number | null
  height: number | null
  cameraMake: string | null
  cameraModel: string | null
  lensModel: string | null
  missing: boolean
}

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
  photos: {
    /** The ordered photo IDs for a view. This is the only place that decides what's in a view. */
    listIds(view: ViewSpec): Promise<number[]>
    /** listIds plus each photo's status. */
    list(view: ViewSpec): Promise<PhotoList>
    counts(libraryId: number, scope: Scope): Promise<StatusCounts>
    /** Reads the photo's EXIF first if that hasn't happened yet, so the date is always real. */
    get(id: number): Promise<PhotoMeta | null>
    revealInFinder(id: number): Promise<void>
    copyPath(id: number): Promise<void>
  }
  marks: {
    /** Sets a photo's status and logs it (for undo). Returns the updated photo. */
    set(photoId: number, status: Status): Promise<PhotoMeta | null>
    /** Undoes the most recent change in the library — a whole batch if it was a bulk action. */
    undo(libraryId: number): Promise<UndoResult | null>
  }
  settings: {
    get<T>(key: string): Promise<T | null>
    set<T>(key: string, value: T): Promise<void>
  }
  /** Commands from the app menu (e.g. 'open-folder', 'rescan'). */
  onMenu(cb: (command: string) => void): Unsubscribe
}

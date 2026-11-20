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
  /** Photos present on disk and not hidden (missing and hidden ones are excluded from the other counts too). */
  total: number
  /** Present but hidden from review (e.g. duplicate copies). */
  hidden: number
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

/** A folder in a library, with counts that include its subfolders. */
export interface FolderInfo {
  /** Relative to the library root; '' is the root itself. */
  dirPath: string
  total: number
  unreviewed: number
}

export interface DuplicateSummary {
  /** Copies beyond the first in each group (hidden or not). */
  extraCopies: number
  /** How many copies "Hide duplicates" would hide right now. */
  hideable: number
  /** Copies already hidden as duplicates. */
  hidden: number
  /** Photos that have at least one identical copy. */
  groups: number
  /** False while some photos still need hashing (the counts aren't final yet). */
  hashingDone: boolean
  hashed: number
  total: number
}

export type ScanPhase = 'walking' | 'metadata' | 'tasks' | 'done' | 'error'

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
  /** Background passes from optional features (phase 'tasks'), e.g. "Hashing". */
  taskLabel?: string
  taskDone?: number
  taskTotal?: number
  message?: string
}

export type Unsubscribe = () => void

export type Appearance = 'system' | 'light' | 'dark'

/** UI preferences (set from the View menu). */
export interface UiSettings {
  theme: string
  appearance: Appearance
  animations: boolean
  /** The effective mode right now (Appearance, or the system setting when it's 'system'). */
  dark: boolean
}

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

export type UndoChange =
  { photoId: number; field: 'status'; status: Status } | { photoId: number; field: 'hidden'; hidden: boolean }

export interface UndoResult {
  /** What was restored, most recent change first. */
  changes: UndoChange[]
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
  /** Hidden from review (e.g. an identical copy); its status is unaffected. */
  hidden: boolean
  hiddenReason: string | null
}

/** The API exposed to the renderer as `window.photonic` (see src/preload). Grows milestone by milestone. */
export interface PhotonicAPI {
  app: {
    info(): Promise<AppInfo>
    toggleFullScreen(): Promise<void>
    isFullScreen(): Promise<boolean>
    onFullScreen(cb: (on: boolean) => void): Unsubscribe
    ui(): Promise<UiSettings>
    /** Fires when a UI setting changes from the menu. */
    onUiChanged(cb: (ui: UiSettings) => void): Unsubscribe
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
    /** Every folder that contains photos (directly or in subfolders), in natural order. */
    folders(id: number): Promise<FolderInfo[]>
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
  features: {
    /** Names of the optional features that are turned on, e.g. ['dedupe']. */
    enabled(): Promise<string[]>
  }
  /** Only works when the 'dedupe' feature is enabled (PLAN.md §8). */
  duplicates: {
    summary(libraryId: number): Promise<DuplicateSummary>
    copies(photoId: number): Promise<PhotoMeta[]>
    /** How many copies `hide` would hide, without changing anything. */
    previewHide(libraryId: number): Promise<number>
    /** Hides the extra copies from review (their Like/Meh status is not touched). */
    hide(libraryId: number): Promise<{ hidden: number; batchId: number | null }>
  }
  /** Commands from the app menu (e.g. 'open-folder', 'rescan'). */
  onMenu(cb: (command: string) => void): Unsubscribe
}

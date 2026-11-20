/** Which playlist a photo is in; null = Unreviewed (PLAN.md §12). */
export type PlaylistId = number | null

export interface Playlist {
  id: number
  name: string
  /** 'like' / 'meh' for the two built-in playlists (renamable, not deletable). */
  builtin: 'like' | 'meh' | null
  /** Single-key shortcut that puts the current photo in this playlist (KeyboardEvent.key). */
  shortcut: string | null
  /** Photos in it, across all libraries (missing files excluded). */
  photoCount: number
}

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
  /** Photos in any playlist. */
  reviewed: number
  /** Photos whose EXIF has been read. */
  metaRead: number
  /** Photos with an EXIF capture date. */
  withTakenAt: number
  folders: number
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

/** A folder of the library chosen for "put a whole folder in a playlist", with counts (subfolders included). */
export interface FolderTarget {
  /** Relative to the library root ('' = the root itself). */
  dirPath: string
  absPath: string
  total: number
  unreviewed: number
  /** Photos per playlist id. */
  byPlaylist: Record<number, number>
}

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
  /** Photos per playlist id. */
  byPlaylist: Record<number, number>
}

/** A view's photo IDs with each photo's playlist (same order), so the renderer can find the next unreviewed one. */
export interface PhotoList {
  ids: number[]
  playlists: PlaylistId[]
}

export type UndoChange =
  { photoId: number; field: 'playlist'; playlistId: PlaylistId } | { photoId: number; field: 'hidden'; hidden: boolean }

export interface UndoResult {
  /** What was restored, most recent change first. */
  changes: UndoChange[]
}

export type SortOrder = 'filename' | 'date' | 'random'
/** Core filters, `playlist:<id>` for one playlist; optional features may add more (e.g. 'duplicates'). */
export type Filter = 'all' | 'unreviewed' | `playlist:${number}` | (string & {})

/** Everything that defines "the list of photos being viewed" (PLAN.md §7). */
export interface ViewSpec {
  libraryId: number
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
  /** The playlist it's in, or null when unreviewed. */
  playlistId: PlaylistId
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
  /** Hidden from review (e.g. an identical copy); its playlist is unaffected. */
  hidden: boolean
  hiddenReason: string | null
}

/** The API exposed to the renderer as `window.photonic` (see src/preload). Grows milestone by milestone. */
/** How exported copies are named (PLAN.md §15). */
export type ExportNaming = 'original' | 'sequential' | 'date'

export interface ExportProgress {
  done: number
  total: number
}

export interface ExportResult {
  destDir: string
  copied: number
  /** Photos that couldn't be copied ('missing' = the original isn't there any more). */
  failed: { path: string; reason: string }[]
  cancelled: boolean
}

export interface PhotonicAPI {
  app: {
    info(): Promise<AppInfo>
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
    onProgress(cb: (p: ScanProgress) => void): Unsubscribe
  }
  photos: {
    /** The ordered photo IDs for a view. This is the only place that decides what's in a view. */
    listIds(view: ViewSpec): Promise<number[]>
    /** listIds plus each photo's playlist. */
    list(view: ViewSpec): Promise<PhotoList>
    counts(libraryId: number): Promise<StatusCounts>
    /** Reads the photo's EXIF first if that hasn't happened yet, so the date is always real. */
    get(id: number): Promise<PhotoMeta | null>
    revealInFinder(id: number): Promise<void>
    copyPath(id: number): Promise<void>
  }
  marks: {
    /** Puts a photo in a playlist (null = back to Unreviewed), logged for undo. Returns the updated photo. */
    set(photoId: number, playlistId: PlaylistId): Promise<PhotoMeta | null>
    /** Undoes the most recent change in the library — a whole batch if it was a bulk action. */
    undo(libraryId: number): Promise<UndoResult | null>
  }
  folders: {
    /** Resolves a typed path (absolute, relative to the library, or ~/…) to a folder of the library. */
    resolve(libraryId: number, path: string): Promise<FolderTarget | { error: string }>
    /** Native folder chooser, starting at the library root. Returns the chosen path. */
    pick(libraryId: number): Promise<string | null>
    /** Puts the folder's photos in a playlist as one undoable batch ('unreviewed' = only unmarked ones). */
    mark(
      libraryId: number,
      dirPath: string,
      playlistId: number,
      mode: 'all' | 'unreviewed'
    ): Promise<{ changed: number; batchId: number | null }>
  }
  playlists: {
    /** All playlists, alphabetically. */
    list(): Promise<Playlist[]>
    create(name: string): Promise<Playlist>
    rename(id: number, name: string): Promise<Playlist>
    /** Gives a playlist a key (null = none). Another playlist holding that key loses it. */
    setShortcut(id: number, key: string | null): Promise<Playlist[]>
    /**
     * Restores Like = ↑ and Meh = ↓ and removes playlist keys that clash with `systemKeys`;
     * other keys you set up stay.
     */
    resetShortcuts(systemKeys: string[]): Promise<Playlist[]>
    /** Deletes a playlist (not Like/Meh), moving its photos to `moveTo` (null = Unreviewed). Not undoable. */
    remove(id: number, moveTo: PlaylistId): Promise<{ moved: number }>
    /** Fires when playlists change (from any window). */
    onChanged(cb: () => void): Unsubscribe
  }
  exports: {
    /** Asks for a destination folder (can create one). Null if cancelled. */
    pickFolder(): Promise<string | null>
    /** How many photos an export of this playlist copies (no missing files or hidden duplicates). */
    count(playlistId: number): Promise<number>
    /** Copies a playlist's photos (all libraries) into `destDir`, flat. Originals are never touched. */
    run(playlistId: number, destDir: string, naming: ExportNaming): Promise<ExportResult>
    /** Stops a running export after the file being copied. */
    cancel(): Promise<void>
    reveal(destDir: string): Promise<void>
    onProgress(cb: (p: ExportProgress) => void): Unsubscribe
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
    /** Hides the extra copies from review (their playlists are not touched). */
    hide(libraryId: number): Promise<{ hidden: number; batchId: number | null }>
  }
  /** Commands from the app menu (e.g. 'open-folder', 'rescan'). */
  onMenu(cb: (command: string) => void): Unsubscribe
}

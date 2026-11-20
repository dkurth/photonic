import type { DB } from '../db'

export interface LibraryRow {
  id: number
  root_path: string
  name: string
  added_at: string
  last_scanned_at: string | null
}

/** The bits of a photo row that scan hooks need. */
export interface ScanPhoto {
  id: number
  relPath: string
  sizeBytes: number
  mtimeMs: number
}

export interface ScanContext {
  db: DB
  library: LibraryRow
  signal?: AbortSignal
}

/** "The missing photo `missingId` is really the newly found photo `addedId`." */
export interface MovePair {
  missingId: number
  addedId: number
}

/** Extension points for optional features (PLAN.md §8). */
export interface ScanHooks {
  /** Called once per scan when there are both new and missing photos. */
  matchMoves?(ctx: ScanContext, added: ScanPhoto[], missing: ScanPhoto[]): Promise<MovePair[]>
  /** Called after a scan completes successfully. */
  afterScan?(ctx: ScanContext): void
  /**
   * Long-running work to do after the scan and EXIF pass (e.g. hashing). Runs inside the same
   * cancellable job, so it stops whenever another scan starts; it must be safe to resume.
   */
  backgroundPass?: {
    label: string
    run(ctx: ScanContext & { onProgress: (done: number, total: number) => void }): Promise<void>
  }
}

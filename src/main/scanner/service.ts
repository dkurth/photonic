import type { ScanProgress } from '@shared/types'
import type { DB } from '../db'
import { getLibraryRow } from '../library'
import { runMetadataPass, type Extractor } from './metadata'
import { scanLibrary } from './scan'
import type { ScanHooks } from './types'

export interface ScanServiceDeps {
  hooks: () => ScanHooks[]
  extract: Extractor
  emit: (p: ScanProgress) => void
  /** Minimum ms between progress events within a phase (phase changes always emit). */
  throttleMs?: number
}

interface Job {
  libraryId: number
  phase: 'walking' | 'metadata' | 'tasks'
  abort: AbortController
  done: Promise<void>
}

/**
 * Runs scan → metadata pass → feature background passes for one library at a time (PLAN.md §6).
 * - Asking to scan the library that is already *walking* reuses that run.
 * - Anything else cancels the current job first. Both steps are safe to interrupt:
 *   finished batches stay committed, and the metadata pass resumes from where it stopped.
 */
export class ScanService {
  private job: Job | null = null

  constructor(
    private db: DB,
    private deps: ScanServiceDeps
  ) {}

  get current(): { libraryId: number; phase: string } | null {
    return this.job ? { libraryId: this.job.libraryId, phase: this.job.phase } : null
  }

  scan(libraryId: number): Promise<void> {
    if (this.job?.libraryId === libraryId && this.job.phase === 'walking') return this.job.done

    // Record the new job synchronously, so concurrent calls see it; it waits for the old one to stop.
    const prev = this.job
    prev?.abort.abort()
    const job: Job = { libraryId, phase: 'walking', abort: new AbortController(), done: Promise.resolve() }
    job.done = (async () => {
      await prev?.done.catch(() => {})
      await this.run(job)
    })().finally(() => {
      if (this.job === job) this.job = null
    })
    this.job = job
    return job.done
  }

  async cancel(): Promise<void> {
    const job = this.job
    if (!job) return
    job.abort.abort()
    await job.done.catch(() => {})
  }

  private async run(job: Job): Promise<void> {
    const { signal } = job.abort
    const progress: ScanProgress = {
      libraryId: job.libraryId,
      phase: 'walking',
      found: 0,
      added: 0,
      changed: 0,
      missing: 0,
      moved: 0,
      unreadableFolders: 0,
      metaDone: 0,
      metaTotal: 0
    }
    let last = 0
    const emit = (force = false): void => {
      const now = Date.now()
      if (!force && now - last < (this.deps.throttleMs ?? 100)) return
      last = now
      this.deps.emit({ ...progress })
    }

    try {
      const library = getLibraryRow(this.db, job.libraryId)
      if (!library) throw new Error(`Library ${job.libraryId} not found`)
      emit(true)

      const counts = await scanLibrary(this.db, library, {
        hooks: this.deps.hooks(),
        signal,
        onProgress: (c) => {
          Object.assign(progress, {
            found: c.found,
            added: c.added,
            changed: c.changed,
            missing: c.missing,
            moved: c.moved,
            unreadableFolders: c.errors.length
          })
          emit()
        }
      })
      Object.assign(progress, {
        found: counts.found,
        added: counts.added,
        changed: counts.changed,
        missing: counts.missing,
        moved: counts.moved,
        unreadableFolders: counts.errors.length
      })

      job.phase = 'metadata'
      progress.phase = 'metadata'
      emit(true)
      await runMetadataPass(this.db, library, this.deps.extract, {
        signal,
        onProgress: (p) => {
          progress.metaDone = p.done
          progress.metaTotal = p.total
          emit()
        }
      })

      for (const hook of this.deps.hooks()) {
        if (!hook.backgroundPass) continue
        const pass = hook.backgroundPass
        job.phase = 'tasks'
        Object.assign(progress, { phase: 'tasks', taskLabel: pass.label, taskDone: 0, taskTotal: 0 })
        emit(true)
        await pass.run({
          db: this.db,
          library,
          signal,
          onProgress: (done, total) => {
            progress.taskDone = done
            progress.taskTotal = total
            emit()
          }
        })
      }

      progress.phase = 'done'
      emit(true)
    } catch (err) {
      if (signal.aborted) return // superseded by another job; no error to report
      progress.phase = 'error'
      progress.message = (err as Error).message
      emit(true)
      throw err
    }
  }
}

import type { PhotoMeta } from '@shared/types'

/**
 * Photo metadata by id (memoized IPC calls). `peek` returns already-resolved entries synchronously,
 * so moving to a preloaded photo can render in the same frame as the keypress (PLAN.md §7).
 * The images themselves are preloaded by the Stage as hidden, laid-out <img> elements.
 */
export class PhotoCache {
  private metas = new Map<number, Promise<PhotoMeta | null>>()
  private resolved = new Map<number, PhotoMeta>()

  get(id: number): Promise<PhotoMeta | null> {
    let p = this.metas.get(id)
    if (!p) {
      p = window.photonic.photos
        .get(id)
        .catch(() => null)
        .then((m) => {
          if (m && this.metas.get(id) === p) this.resolved.set(id, m)
          return m
        })
      this.metas.set(id, p)
    }
    return p
  }

  /** The metadata if it has already arrived, without waiting. */
  peek(id: number): PhotoMeta | undefined {
    return this.resolved.get(id)
  }

  /** Replace a cached entry (e.g. after a status change). */
  set(meta: PhotoMeta): void {
    this.metas.set(meta.id, Promise.resolve(meta))
    this.resolved.set(meta.id, meta)
  }

  /** Forget one photo's metadata so it's fetched again next time. */
  invalidate(id: number): void {
    this.metas.delete(id)
    this.resolved.delete(id)
  }

  clear(): void {
    this.metas.clear()
    this.resolved.clear()
  }
}

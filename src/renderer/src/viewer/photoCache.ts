import type { PhotoMeta } from '@shared/types'

/**
 * Photo metadata by id (memoized IPC calls) plus decoded neighbor images, so moving to the next
 * or previous photo is instant (PLAN.md §7).
 */
export class PhotoCache {
  private metas = new Map<number, Promise<PhotoMeta | null>>()
  private images = new Map<number, HTMLImageElement>()

  get(id: number): Promise<PhotoMeta | null> {
    let p = this.metas.get(id)
    if (!p) {
      p = window.photonic.photos.get(id).catch(() => null)
      this.metas.set(id, p)
    }
    return p
  }

  /** Replace a cached entry (e.g. after a status change). */
  set(meta: PhotoMeta): void {
    this.metas.set(meta.id, Promise.resolve(meta))
  }

  /** Starts loading + decoding the image so it can be shown without a flash. */
  preload(meta: PhotoMeta): void {
    if (this.images.has(meta.id) || meta.missing) return
    const img = new Image()
    img.src = meta.url
    img.decode().catch(() => {})
    this.images.set(meta.id, img)
  }

  /** Drop decoded images that are no longer near the current photo. */
  keepImages(ids: Iterable<number>): void {
    const keep = new Set(ids)
    for (const id of this.images.keys()) if (!keep.has(id)) this.images.delete(id)
  }

  clear(): void {
    this.metas.clear()
  }
}

import type { Worker } from 'node:worker_threads'
import createMetadataWorker from './metadataWorker?nodeWorker'
import { EMPTY_METADATA, type PhotoMetadata } from './exif'
import type { Extractor } from './metadata'

/**
 * An Extractor backed by one worker thread. If the worker dies, pending reads resolve to
 * empty metadata and the next read starts a new worker.
 */
export function createWorkerExtractor(): { extract: Extractor; close: () => Promise<void> } {
  let worker: Worker | null = null
  let nextId = 1
  const pending = new Map<number, (m: PhotoMetadata) => void>()

  function failAll(): void {
    for (const resolve of pending.values()) resolve(EMPTY_METADATA)
    pending.clear()
    worker = null
  }

  function getWorker(): Worker {
    if (worker) return worker
    const w = createMetadataWorker({})
    w.on('message', (msg: { id: number; meta: PhotoMetadata }) => {
      pending.get(msg.id)?.(msg.meta)
      pending.delete(msg.id)
    })
    w.on('error', (err) => {
      console.error('Metadata worker error:', err)
      failAll()
    })
    w.on('exit', () => {
      if (worker === w) failAll()
    })
    w.unref()
    worker = w
    return w
  }

  return {
    extract: (path) =>
      new Promise((resolve) => {
        const id = nextId++
        pending.set(id, resolve)
        getWorker().postMessage({ id, path })
      }),
    close: async () => {
      const w = worker
      worker = null
      failAll()
      await w?.terminate()
    }
  }
}

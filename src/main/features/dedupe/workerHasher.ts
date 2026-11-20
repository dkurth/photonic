import type { Worker } from 'node:worker_threads'
import createHashWorker from './hashWorker?nodeWorker'
import type { Hasher } from './hash'

/** A Hasher backed by one worker thread; if it dies, pending hashes resolve to null. */
export function createWorkerHasher(): { hash: Hasher; close: () => Promise<void> } {
  let worker: Worker | null = null
  let nextId = 1
  const pending = new Map<number, (h: string | null) => void>()

  function failAll(): void {
    for (const resolve of pending.values()) resolve(null)
    pending.clear()
    worker = null
  }

  function getWorker(): Worker {
    if (worker) return worker
    const w = createHashWorker({})
    w.on('message', (msg: { id: number; hash: string | null }) => {
      pending.get(msg.id)?.(msg.hash)
      pending.delete(msg.id)
    })
    w.on('error', (err) => {
      console.error('Hash worker error:', err)
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
    hash: (path) =>
      new Promise((resolve) => {
        const id = nextId++
        pending.set(id, resolve)
        getWorker().postMessage({ id, path })
      }),
    close: async () => {
      const w = worker
      failAll()
      await w?.terminate()
    }
  }
}

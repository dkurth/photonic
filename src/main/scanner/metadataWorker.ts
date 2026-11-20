// Worker thread: reads EXIF off the main process's event loop.
import { parentPort } from 'node:worker_threads'
import { readMetadata } from './exif'

parentPort!.on('message', async (msg: { id: number; path: string }) => {
  const meta = await readMetadata(msg.path)
  parentPort!.postMessage({ id: msg.id, meta })
})

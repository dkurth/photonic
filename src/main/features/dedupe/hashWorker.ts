// Worker thread: hashes files off the main process's event loop.
import { parentPort } from 'node:worker_threads'
import { hashFile } from './hash'

parentPort!.on('message', async (msg: { id: number; path: string }) => {
  parentPort!.postMessage({ id: msg.id, hash: await hashFile(msg.path) })
})

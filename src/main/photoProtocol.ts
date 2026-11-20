import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import type { DB } from './db'
import { resolvePhotoFile } from './photos'

export const PHOTO_SCHEME = 'photo'

/** Must run before app 'ready'. */
export function registerPhotoScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: PHOTO_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

/**
 * Serves photo://img/<id> by looking the id up in the DB (PLAN.md §4). The renderer never
 * builds file paths, and only files inside a library root can be served.
 */
export function handlePhotoProtocol(getDb: () => DB | null): void {
  protocol.handle(PHOTO_SCHEME, (req) => {
    const db = getDb()
    const m = /^\/(\d+)$/.exec(new URL(req.url).pathname)
    const file = db && m ? resolvePhotoFile(db, Number(m[1])) : null
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

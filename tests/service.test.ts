import { describe, expect, it } from 'vitest'
import type { ScanProgress } from '@shared/types'
import { migrate, openDatabase } from '../src/main/db'
import { coreMigrations } from '../src/main/db/migrations'
import { addLibrary } from '../src/main/library'
import { EMPTY_METADATA, readMetadata } from '../src/main/scanner/exif'
import { ScanService } from '../src/main/scanner/service'
import { jpegWithExif } from './fixtures'
import { makeTree, tempDir } from './helpers'

function setup(n: number) {
  const root = tempDir()
  const files: Record<string, Buffer> = {}
  for (let i = 0; i < n; i++) files[`d${i % 3}/p${i}.jpg`] = jpegWithExif({ dateTimeOriginal: '2022:02:02 02:02:02' })
  makeTree(root, files)
  const db = openDatabase(':memory:')
  migrate(db, coreMigrations)
  return { db, lib: addLibrary(db, root) }
}

describe('ScanService', () => {
  it('runs walk → metadata → done and reports progress', async () => {
    const { db, lib } = setup(12)
    const events: ScanProgress[] = []
    const svc = new ScanService(db, {
      hooks: () => [],
      extract: readMetadata,
      emit: (p) => events.push(p),
      throttleMs: 0
    })
    await svc.scan(lib.id)

    const phases = [...new Set(events.map((e) => e.phase))]
    expect(phases).toEqual(['walking', 'metadata', 'done'])
    expect(events.at(-1)).toMatchObject({ phase: 'done', found: 12, added: 12, metaDone: 12, metaTotal: 12 })
    expect(db.prepare('SELECT count(*) FROM photos WHERE taken_at IS NOT NULL').pluck().get()).toBe(12)
    expect(svc.current).toBeNull()
  })

  it('reports errors (e.g. a vanished library folder) as an error event', async () => {
    const db = openDatabase(':memory:')
    migrate(db, coreMigrations)
    db.prepare("INSERT INTO libraries (root_path, name) VALUES ('/definitely/not/here', 'gone')").run()
    const events: ScanProgress[] = []
    const svc = new ScanService(db, { hooks: () => [], extract: readMetadata, emit: (p) => events.push(p) })
    await expect(svc.scan(1)).rejects.toThrow(/not found/)
    expect(events.at(-1)).toMatchObject({ phase: 'error', message: expect.stringMatching(/not found/) })
  })

  it('a second scan request for a library that is still walking reuses the running scan', async () => {
    const { db, lib } = setup(3)
    let walks = 0
    const svc = new ScanService(db, {
      hooks: () => [{ afterScan: () => void walks++ }],
      extract: async () => EMPTY_METADATA,
      emit: () => {}
    })
    await Promise.all([svc.scan(lib.id), svc.scan(lib.id)])
    expect(walks).toBe(1)
  })

  it('cancelling stops the metadata pass quietly, and the next scan finishes the job', async () => {
    const { db, lib } = setup(30)
    const events: ScanProgress[] = []
    let svc: ScanService
    let n = 0
    const extract = async (p: string) => {
      if (++n === 5) void svc.cancel()
      return readMetadata(p)
    }
    svc = new ScanService(db, { hooks: () => [], extract, emit: (p) => events.push(p), throttleMs: 0 })
    await svc.scan(lib.id) // resolves quietly when cancelled
    expect(events.some((e) => e.phase === 'error')).toBe(false)
    expect(db.prepare('SELECT count(*) FROM photos WHERE meta_read_at IS NULL').pluck().get()).toBeGreaterThan(0)

    await svc.scan(lib.id)
    expect(db.prepare('SELECT count(*) FROM photos WHERE meta_read_at IS NULL').pluck().get()).toBe(0)
  })

  it('opening another library cancels the current job; jobs never overlap', async () => {
    const a = setup(20)
    const rootB = tempDir()
    makeTree(rootB, { 'b1.jpg': jpegWithExif({}), 'b2.jpg': jpegWithExif({}) })
    const libB = addLibrary(a.db, rootB)

    let active = 0
    let maxActive = 0
    const extract = async (p: string) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 1))
      active--
      return readMetadata(p)
    }
    const events: ScanProgress[] = []
    const svc = new ScanService(a.db, { hooks: () => [], extract, emit: (p) => events.push(p), throttleMs: 0 })
    const first = svc.scan(a.lib.id)
    const second = svc.scan(libB.id)
    await Promise.all([first, second])

    expect(events.filter((e) => e.libraryId === libB.id).at(-1)).toMatchObject({ phase: 'done', found: 2 })
    expect(events.some((e) => e.libraryId === a.lib.id && e.phase === 'done')).toBe(false)
    expect(maxActive).toBeLessThanOrEqual(4) // one job's concurrency, never two jobs at once
  })
})

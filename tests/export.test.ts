import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate, openDatabase } from '../src/main/db'
import { coreMigrations } from '../src/main/db/migrations'
import { exportSources, planNames, runExport } from '../src/main/export'
import { setHidden, setPlaylist } from '../src/main/marks'
import { LIKE, MEH } from './helpers'

const item = (relPath: string, date = '2019-07-04 15:30:12') => ({ src: `/lib/${relPath}`, relPath, date })
const names = (items: ReturnType<typeof item>[], naming: 'original' | 'sequential' | 'date', existing?: string[]) =>
  planNames(items, naming, existing).map((i) => i.name)

describe('planNames', () => {
  it('original: keeps names, adds _2, _3 before the extension for clashes (case-insensitive)', () => {
    expect(names([item('a/IMG_1.jpg'), item('b/IMG_1.jpg'), item('c/img_1.JPG'), item('d/x.png')], 'original')).toEqual(
      ['IMG_1.jpg', 'IMG_1_2.jpg', 'img_1_3.JPG', 'x.png']
    )
  })

  it('never reuses a name already in the folder', () => {
    expect(names([item('IMG_1.jpg'), item('001.jpg')], 'original', ['img_1.jpg', 'IMG_1_2.jpg'])).toEqual([
      'IMG_1_3.jpg',
      '001.jpg'
    ])
    expect(names([item('a.jpg')], 'sequential', ['001.jpg'])).toEqual(['001_2.jpg'])
  })

  it('sequential: 001… with as many digits as the count needs (at least 3), keeping each extension', () => {
    expect(names([item('a.jpg'), item('b.PNG')], 'sequential')).toEqual(['001.jpg', '002.PNG'])
    const many = Array.from({ length: 1200 }, (_, i) => item(`p${i}.jpg`))
    const n = names(many, 'sequential')
    expect([n[0], n[999], n[1199]]).toEqual(['0001.jpg', '1000.jpg', '1200.jpg'])
  })

  it('date: YYYYMMDD_HHMMSS, _2 for a second photo taken in the same second', () => {
    expect(names([item('a.jpg'), item('b.jpg'), item('c.jpeg', '2020-01-02 03:04:05'), item('d.jpg')], 'date')).toEqual(
      ['20190704_153012.jpg', '20190704_153012_2.jpg', '20200102_030405.jpeg', '20190704_153012_3.jpg']
    )
  })
})

describe('exportSources + runExport', () => {
  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'photonic-export-src-'))
    const dest = mkdtempSync(join(tmpdir(), 'photonic-export-dst-'))
    mkdirSync(join(root, 'a'))
    mkdirSync(join(root, 'b'))
    const files = { 'a/IMG_1.jpg': '2019-07-04 15:30:12', 'b/IMG_1.jpg': '2018-01-01 00:00:00', 'b/z.jpg': null }
    const db = openDatabase(':memory:')
    migrate(db, coreMigrations)
    const lib = Number(
      db.prepare('INSERT INTO libraries (root_path, name) VALUES (?, ?)').run(root, 'r').lastInsertRowid
    )
    const ids: number[] = []
    for (const [rel, taken] of Object.entries(files)) {
      writeFileSync(join(root, rel), `photo ${rel}`)
      utimesSync(join(root, rel), new Date('2021-02-03T04:05:06Z'), new Date('2021-02-03T04:05:06Z'))
      const mtime = statSync(join(root, rel)).mtimeMs
      ids.push(
        Number(
          db
            .prepare(
              'INSERT INTO photos (library_id, rel_path, dir_path, size_bytes, mtime_ms, birthtime_ms, taken_at) VALUES (?, ?, ?, 1, ?, NULL, ?)'
            )
            .run(lib, rel, rel.split('/')[0], mtime, taken).lastInsertRowid
        )
      )
    }
    return { root, dest, db, ids }
  }

  it('copies a playlist flat, oldest first, without touching originals or existing files', async () => {
    const { root, dest, db, ids } = setup()
    for (const id of ids) setPlaylist(db, id, LIKE)
    writeFileSync(join(dest, 'IMG_1.jpg'), 'already here')
    const sources = exportSources(db, LIKE, [])
    expect(sources.map((s) => s.relPath)).toEqual(['b/IMG_1.jpg', 'a/IMG_1.jpg', 'b/z.jpg']) // z: 2021 mtime

    const progress: number[] = []
    const r = await runExport(sources, dest, 'original', { onProgress: (p) => progress.push(p.done) })
    expect(r).toEqual({ destDir: dest, copied: 3, failed: [], cancelled: false })
    expect(readdirSync(dest).sort()).toEqual(['IMG_1.jpg', 'IMG_1_2.jpg', 'IMG_1_3.jpg', 'z.jpg'])
    expect(readFileSync(join(dest, 'IMG_1.jpg'), 'utf8')).toBe('already here')
    expect(readFileSync(join(dest, 'IMG_1_2.jpg'), 'utf8')).toBe('photo b/IMG_1.jpg')
    expect(readFileSync(join(root, 'a/IMG_1.jpg'), 'utf8')).toBe('photo a/IMG_1.jpg')
    expect(statSync(join(dest, 'z.jpg')).mtime.toISOString()).toBe('2021-02-03T04:05:06.000Z')
    expect(progress.at(-1)).toBe(3)
  })

  it('only the playlist, skips hidden duplicates while dedupe is on, and reports missing originals', async () => {
    const { root, dest, db, ids } = setup()
    setPlaylist(db, ids[0], MEH)
    setPlaylist(db, ids[1], MEH)
    setPlaylist(db, ids[2], LIKE)
    setHidden(db, ids[1], true, 'duplicate')
    expect(exportSources(db, MEH, ['duplicate']).map((s) => s.relPath)).toEqual(['a/IMG_1.jpg'])
    expect(exportSources(db, MEH, []).length).toBe(2)
    db.prepare('UPDATE photos SET missing = 1 WHERE id = ?').run(ids[2])
    expect(exportSources(db, LIKE, []).length).toBe(0) // the scan found it missing

    const { rmSync } = await import('node:fs')
    rmSync(join(root, 'a/IMG_1.jpg'))
    const r = await runExport(exportSources(db, MEH, []), dest, 'sequential')
    expect(r.copied).toBe(1)
    expect(r.failed).toEqual([{ path: join(root, 'a/IMG_1.jpg'), reason: 'missing' }])
    expect(readdirSync(dest)).toEqual(['001.jpg'])
  })

  it('stops when cancelled', async () => {
    const { dest, db, ids } = setup()
    for (const id of ids) setPlaylist(db, id, LIKE)
    let n = 0
    const r = await runExport(exportSources(db, LIKE, []), dest, 'date', {
      onProgress: () => n++,
      isCancelled: () => readdirSync(dest).length >= 1
    })
    expect(r).toMatchObject({ copied: 1, cancelled: true })
  })
})

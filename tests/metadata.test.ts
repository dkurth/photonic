import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrate, openDatabase, type DB } from '../src/main/db'
import { coreMigrations } from '../src/main/db/migrations'
import { addLibrary } from '../src/main/library'
import { EMPTY_METADATA, normalizeExifDate, readMetadata, type PhotoMetadata } from '../src/main/scanner/exif'
import { countNeedingMetadata, ensureMetadata, runMetadataPass } from '../src/main/scanner/metadata'
import { scanLibrary } from '../src/main/scanner/scan'
import { jpegWithExif, jpegWithoutExif } from './fixtures'
import { makeTree, tempDir } from './helpers'

describe('normalizeExifDate', () => {
  it.each([
    ['2019:07:04 14:32:10', '2019-07-04 14:32:10'],
    ['2019:07:04 14:32:10.123', '2019-07-04 14:32:10'],
    ['2019:07:04 14:32:10+02:00', '2019-07-04 14:32:10'],
    ['2019-07-04T14:32:10', '2019-07-04 14:32:10'],
    ['  2019:07:04 14:32:10  ', '2019-07-04 14:32:10']
  ])('%s → %s', (raw, want) => expect(normalizeExifDate(raw)).toBe(want))

  it.each([
    ['0000:00:00 00:00:00'],
    ['    :  :     :  :  '],
    [''],
    ['garbage'],
    ['2019:13:01 00:00:00'],
    [undefined],
    [12345]
  ])('rejects %s', (raw) => expect(normalizeExifDate(raw)).toBeNull())
})

describe('readMetadata', () => {
  it('reads date, camera, lens, size and extras — in camera-local time, not shifted by time zone', async () => {
    const f = join(tempDir(), 'a.jpg')
    writeFileSync(
      f,
      jpegWithExif({
        make: 'Canon',
        model: 'EOS R6',
        lens: 'RF35mm F1.8',
        dateTimeOriginal: '2019:07:04 14:32:10',
        width: 6000,
        height: 4000,
        iso: 200,
        orientation: 6,
        gps: { lat: 43.7696, lon: 11.2558 }
      })
    )
    const m = await readMetadata(f)
    expect(m).toMatchObject({
      takenAt: '2019-07-04 14:32:10',
      cameraMake: 'Canon',
      cameraModel: 'EOS R6',
      lensModel: 'RF35mm F1.8',
      width: 6000,
      height: 4000
    })
    expect(m.extra).toMatchObject({ ISO: 200, Orientation: 6 })
    expect(m.extra!.latitude as number).toBeCloseTo(43.7696, 3)
    expect(m.extra!.longitude as number).toBeCloseTo(11.2558, 3)
  })

  it('falls back to CreateDate when DateTimeOriginal is absent', async () => {
    const f = join(tempDir(), 'a.jpg')
    writeFileSync(f, jpegWithExif({ make: 'Apple', createDate: '2020:01:02 03:04:05' }))
    expect((await readMetadata(f)).takenAt).toBe('2020-01-02 03:04:05')
  })

  it('returns empty metadata for files with no EXIF, non-images, and missing files — never throws', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'plain.jpg'), jpegWithoutExif())
    writeFileSync(join(dir, 'junk.jpg'), 'this is not an image')
    expect(await readMetadata(join(dir, 'plain.jpg'))).toEqual(EMPTY_METADATA)
    expect(await readMetadata(join(dir, 'junk.jpg'))).toEqual(EMPTY_METADATA)
    expect(await readMetadata(join(dir, 'nope.jpg'))).toEqual(EMPTY_METADATA)
  })
})

async function library(
  files: Record<string, string | Buffer>
): Promise<{ db: DB; lib: ReturnType<typeof addLibrary> }> {
  const root = tempDir()
  makeTree(root, files)
  const db = openDatabase(':memory:')
  migrate(db, coreMigrations)
  const lib = addLibrary(db, root)
  await scanLibrary(db, lib)
  return { db, lib }
}

describe('runMetadataPass', () => {
  it('reads every unread photo and stores the fields', async () => {
    const { db, lib } = await library({
      'with.jpg': jpegWithExif({ make: 'Fujifilm', model: 'X100V', dateTimeOriginal: '2021:05:06 07:08:09' }),
      'without.jpg': jpegWithoutExif(),
      'junk.png': 'not really a png'
    })
    const p = await runMetadataPass(db, lib, readMetadata)
    expect(p).toEqual({ done: 3, total: 3 })
    expect(countNeedingMetadata(db, lib.id)).toBe(0)

    const rows = db
      .prepare('SELECT rel_path, taken_at, camera_model, meta_read_at FROM photos ORDER BY rel_path')
      .all() as {
      rel_path: string
      taken_at: string | null
      camera_model: string | null
      meta_read_at: string | null
    }[]
    expect(rows.map((r) => [r.rel_path, r.taken_at, r.camera_model])).toEqual([
      ['junk.png', null, null],
      ['with.jpg', '2021-05-06 07:08:09', 'X100V'],
      ['without.jpg', null, null]
    ])
    expect(rows.every((r) => r.meta_read_at !== null)).toBe(true)
  })

  it('resumes where an interrupted pass stopped', async () => {
    const files: Record<string, Buffer> = {}
    for (let i = 0; i < 10; i++) files[`p${i}.jpg`] = jpegWithoutExif()
    const { db, lib } = await library(files)

    const ac = new AbortController()
    let calls = 0
    const slowExtract = async (): Promise<PhotoMetadata> => {
      if (++calls === 4) ac.abort()
      return EMPTY_METADATA
    }
    await expect(runMetadataPass(db, lib, slowExtract, { signal: ac.signal, concurrency: 2 })).rejects.toThrow()
    const left = countNeedingMetadata(db, lib.id)
    expect(left).toBeGreaterThan(0)
    expect(left).toBeLessThan(10)

    const seen: string[] = []
    await runMetadataPass(db, lib, async (p) => (seen.push(p), EMPTY_METADATA))
    expect(seen).toHaveLength(left) // only the rest are read
    expect(countNeedingMetadata(db, lib.id)).toBe(0)
  })

  it('skips missing photos', async () => {
    const { db, lib } = await library({ 'a.jpg': jpegWithoutExif(), 'b.jpg': jpegWithoutExif() })
    db.prepare("UPDATE photos SET missing = 1 WHERE rel_path = 'b.jpg'").run()
    expect((await runMetadataPass(db, lib, readMetadata)).total).toBe(1)
  })
})

describe('ensureMetadata', () => {
  it('reads an unread photo on demand, once', async () => {
    const { db } = await library({ 'a.jpg': jpegWithExif({ dateTimeOriginal: '2018:01:01 12:00:00' }) })
    const id = db.prepare('SELECT id FROM photos').pluck().get() as number
    let calls = 0
    const extract = async (p: string): Promise<PhotoMetadata> => (calls++, readMetadata(p))
    expect(await ensureMetadata(db, id, extract)).toBe(true)
    expect(await ensureMetadata(db, id, extract)).toBe(false)
    expect(calls).toBe(1)
    expect(db.prepare('SELECT taken_at FROM photos WHERE id = ?').pluck().get(id)).toBe('2018-01-01 12:00:00')
  })
})

/**
 * Builds tiny JPEG files with a real EXIF (TIFF) block, for tests. Only the header matters:
 * the scanner never decodes pixels and exifr only reads the APP1 segment.
 */

type Entry = { tag: number; type: 2 | 3 | 4 | 5; count: number; data: Buffer }

const ascii = (tag: number, s: string): Entry => {
  const data = Buffer.from(s + '\0', 'latin1')
  return { tag, type: 2, count: data.length, data }
}
const short = (tag: number, v: number): Entry => {
  const data = Buffer.alloc(2)
  data.writeUInt16LE(v)
  return { tag, type: 3, count: 1, data }
}
const long = (tag: number, v: number): Entry => {
  const data = Buffer.alloc(4)
  data.writeUInt32LE(v)
  return { tag, type: 4, count: 1, data }
}
const rationals = (tag: number, vals: [number, number][]): Entry => {
  const data = Buffer.alloc(8 * vals.length)
  vals.forEach(([n, d], i) => {
    data.writeUInt32LE(n, i * 8)
    data.writeUInt32LE(d, i * 8 + 4)
  })
  return { tag, type: 5, count: vals.length, data }
}

function ifdSize(entries: Entry[]): number {
  const extra = entries.reduce((n, e) => n + (e.data.length > 4 ? e.data.length + (e.data.length % 2) : 0), 0)
  return 2 + 12 * entries.length + 4 + extra
}

function buildIfd(entries: Entry[], start: number): Buffer {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag)
  const buf = Buffer.alloc(ifdSize(sorted))
  buf.writeUInt16LE(sorted.length, 0)
  let dataOff = 2 + 12 * sorted.length + 4
  sorted.forEach((e, i) => {
    const p = 2 + i * 12
    buf.writeUInt16LE(e.tag, p)
    buf.writeUInt16LE(e.type, p + 2)
    buf.writeUInt32LE(e.count, p + 4)
    if (e.data.length <= 4) {
      e.data.copy(buf, p + 8)
    } else {
      buf.writeUInt32LE(start + dataOff, p + 8)
      e.data.copy(buf, dataOff)
      dataOff += e.data.length + (e.data.length % 2)
    }
  })
  return buf
}

export interface ExifSpec {
  make?: string
  model?: string
  lens?: string
  /** 'YYYY:MM:DD HH:MM:SS' as cameras write it */
  dateTimeOriginal?: string
  createDate?: string
  width?: number
  height?: number
  iso?: number
  orientation?: number
  gps?: { lat: number; lon: number }
}

function dms(deg: number): [number, number][] {
  const a = Math.abs(deg)
  const d = Math.floor(a)
  const mFloat = (a - d) * 60
  const m = Math.floor(mFloat)
  const s = Math.round((mFloat - m) * 60 * 100)
  return [
    [d, 1],
    [m, 1],
    [s, 100]
  ]
}

export function jpegWithExif(spec: ExifSpec): Buffer {
  const exif: Entry[] = []
  if (spec.dateTimeOriginal) exif.push(ascii(0x9003, spec.dateTimeOriginal))
  if (spec.createDate) exif.push(ascii(0x9004, spec.createDate))
  if (spec.width) exif.push(long(0xa002, spec.width))
  if (spec.height) exif.push(long(0xa003, spec.height))
  if (spec.lens) exif.push(ascii(0xa434, spec.lens))
  if (spec.iso) exif.push(short(0x8827, spec.iso))

  const gps: Entry[] = []
  if (spec.gps) {
    gps.push(ascii(0x0001, spec.gps.lat >= 0 ? 'N' : 'S'))
    gps.push(rationals(0x0002, dms(spec.gps.lat)))
    gps.push(ascii(0x0003, spec.gps.lon >= 0 ? 'E' : 'W'))
    gps.push(rationals(0x0004, dms(spec.gps.lon)))
  }

  const ifd0: Entry[] = []
  if (spec.make) ifd0.push(ascii(0x010f, spec.make))
  if (spec.model) ifd0.push(ascii(0x0110, spec.model))
  if (spec.orientation) ifd0.push(short(0x0112, spec.orientation))
  // Pointers get placeholder values first so sizes are known, then real offsets.
  if (exif.length) ifd0.push(long(0x8769, 0))
  if (gps.length) ifd0.push(long(0x8825, 0))

  const ifd0Start = 8
  const exifStart = ifd0Start + ifdSize(ifd0)
  const gpsStart = exifStart + (exif.length ? ifdSize(exif) : 0)
  for (const e of ifd0) {
    if (e.tag === 0x8769) e.data.writeUInt32LE(exifStart)
    if (e.tag === 0x8825) e.data.writeUInt32LE(gpsStart)
  }

  const header = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]) // "II*\0", IFD0 at 8
  const tiff = Buffer.concat([
    header,
    buildIfd(ifd0, ifd0Start),
    exif.length ? buildIfd(exif, exifStart) : Buffer.alloc(0),
    gps.length ? buildIfd(gps, gpsStart) : Buffer.alloc(0)
  ])
  const app1Body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const app1Len = Buffer.alloc(2)
  app1Len.writeUInt16BE(app1Body.length + 2)
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    app1Len,
    app1Body,
    Buffer.from([0xff, 0xd9])
  ])
}

/** A "JPEG" with no EXIF at all. */
export function jpegWithoutExif(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xd9])
}

import exifr from 'exifr'

export interface PhotoMetadata {
  /** Camera-local capture time, 'YYYY-MM-DD HH:MM:SS' (no time zone — cameras rarely record one). */
  takenAt: string | null
  width: number | null
  height: number | null
  cameraMake: string | null
  cameraModel: string | null
  lensModel: string | null
  /** A small subset of other fields, kept for later (info panel etc.). */
  extra: Record<string, unknown> | null
}

export const EMPTY_METADATA: PhotoMetadata = {
  takenAt: null,
  width: null,
  height: null,
  cameraMake: null,
  cameraModel: null,
  lensModel: null,
  extra: null
}

const EXTRA_FIELDS = [
  'ISO',
  'ExposureTime',
  'FNumber',
  'FocalLength',
  'Orientation',
  'Software',
  'OffsetTimeOriginal',
  'latitude',
  'longitude'
] as const

/**
 * Converts an EXIF date string ('2019:07:04 14:32:10', optionally with sub-seconds or an offset)
 * to 'YYYY-MM-DD HH:MM:SS'. Returns null for blanks and the all-zero placeholder some cameras write.
 */
export function normalizeExifDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  if (y === '0000' || mo === '00' || d === '00') return null
  if (+mo > 12 || +d > 31 || +h > 23 || +mi > 59 || +s > 60) return null
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\0/g, '').trim()
  return t || null
}

function posInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null
}

/**
 * Reads EXIF from a photo. Only the start of the file is read.
 * Never throws: unreadable files and formats without EXIF give EMPTY_METADATA.
 */
export async function readMetadata(absPath: string): Promise<PhotoMetadata> {
  let tags: Record<string, unknown> | undefined
  try {
    tags = await exifr.parse(absPath, {
      tiff: true,
      exif: true,
      gps: true,
      ihdr: true,
      xmp: false,
      icc: false,
      iptc: false,
      jfif: false,
      // Raw values: revived dates would be shifted by this machine's time zone.
      reviveValues: false,
      translateValues: false
    })
  } catch {
    return EMPTY_METADATA
  }
  if (!tags) return EMPTY_METADATA

  const extra: Record<string, unknown> = {}
  for (const k of EXTRA_FIELDS) {
    const v = tags[k]
    if (v !== undefined && v !== null && v !== '') extra[k] = v
  }

  return {
    takenAt: normalizeExifDate(tags.DateTimeOriginal) ?? normalizeExifDate(tags.CreateDate),
    width: posInt(tags.ExifImageWidth) ?? posInt(tags.ImageWidth),
    height: posInt(tags.ExifImageHeight) ?? posInt(tags.ImageHeight),
    cameraMake: str(tags.Make),
    cameraModel: str(tags.Model),
    lensModel: str(tags.LensModel),
    extra: Object.keys(extra).length ? extra : null
  }
}

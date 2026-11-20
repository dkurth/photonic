import { chmodSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPhotoName, walk, type FoundFile, type WalkError } from '../src/main/scanner/walk'
import { makeTree, tempDir } from './helpers'

async function collect(root: string, onError?: (e: WalkError) => void): Promise<FoundFile[]> {
  const out: FoundFile[] = []
  for await (const batch of walk(root, { onError })) out.push(...batch)
  return out
}

describe('isPhotoName', () => {
  it('accepts the supported extensions in any case', () => {
    for (const n of ['a.jpg', 'a.JPG', 'a.Jpeg', 'a.png', 'a.gif', 'a.webp', 'a.avif', 'a.bmp']) {
      expect(isPhotoName(n), n).toBe(true)
    }
  })
  it('rejects HEIC, RAW, video, sidecars and hidden files', () => {
    for (const n of ['a.heic', 'a.HEIF', 'a.cr2', 'a.nef', 'a.mov', 'a.mp4', 'a.xmp', 'a.aae', '.hidden.jpg', 'jpg']) {
      expect(isPhotoName(n), n).toBe(false)
    }
  })
})

describe('walk', () => {
  it('finds photos in nested folders with relative POSIX paths and stats', async () => {
    const root = tempDir()
    makeTree(root, {
      'top.jpg': 'x',
      '2019/Italy/IMG_1.JPG': 'xx',
      '2019/Italy/IMG_2.png': 'xxx',
      '2019/Italy/clip.mov': 'v',
      '2019/Italy/IMG_3.heic': 'h',
      '2020/a.webp': 'w',
      '.hidden/secret.jpg': 's',
      '2020/.DS_Store': 'd',
      'notes.txt': 't'
    })
    const files = await collect(root)
    expect(files.map((f) => f.relPath).sort()).toEqual([
      '2019/Italy/IMG_1.JPG',
      '2019/Italy/IMG_2.png',
      '2020/a.webp',
      'top.jpg'
    ])
    const img2 = files.find((f) => f.relPath === '2019/Italy/IMG_2.png')!
    expect(img2.dirPath).toBe('2019/Italy')
    expect(img2.sizeBytes).toBe(3)
    expect(img2.mtimeMs).toBeGreaterThan(0)
    expect(files.find((f) => f.relPath === 'top.jpg')!.dirPath).toBe('')
  })

  it('does not follow symlinks (to files or folders), so loops are impossible', async () => {
    const root = tempDir()
    makeTree(root, { 'real/a.jpg': 'a' })
    symlinkSync(join(root, 'real'), join(root, 'link-to-real'))
    symlinkSync(root, join(root, 'real', 'loop'))
    symlinkSync(join(root, 'real', 'a.jpg'), join(root, 'alias.jpg'))
    const files = await collect(root)
    expect(files.map((f) => f.relPath)).toEqual(['real/a.jpg'])
  })

  it('reports unreadable folders and keeps going', async () => {
    const root = tempDir()
    makeTree(root, { 'ok/a.jpg': 'a', 'locked/b.jpg': 'b' })
    chmodSync(join(root, 'locked'), 0o000)
    try {
      const errors: WalkError[] = []
      const files = await collect(root, (e) => errors.push(e))
      expect(files.map((f) => f.relPath)).toEqual(['ok/a.jpg'])
      expect(errors.map((e) => e.dirPath)).toEqual(['locked'])
    } finally {
      chmodSync(join(root, 'locked'), 0o755)
    }
  })

  it('throws if the root itself cannot be read', async () => {
    await expect(collect(join(tempDir(), 'does-not-exist'))).rejects.toThrow()
  })

  it('can be cancelled', async () => {
    const root = tempDir()
    makeTree(root, { 'a/1.jpg': '1', 'b/2.jpg': '2' })
    const ac = new AbortController()
    ac.abort()
    await expect(async () => {
      for await (const _ of walk(root, { signal: ac.signal })) void _
    }).rejects.toThrow()
  })
})

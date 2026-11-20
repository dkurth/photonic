import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach } from 'vitest'

const dirs: string[] = []

/** Ids of the built-in playlists in a fresh database (migration 004 creates Like, then Meh). */
export const LIKE = 1
export const MEH = 2

/** A fresh temp directory, removed after the current test. */
export function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'photonic-test-'))
  dirs.push(d)
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Creates files (and their parent folders) under root. */
export function makeTree(root: string, files: Record<string, string | Buffer>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
}

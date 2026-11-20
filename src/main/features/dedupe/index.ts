// The dedupe feature (PLAN.md §8): content hashing, move/rename detection, duplicate handling.
// Removable: nothing in the core imports this folder. See PLAN.md §8 "How it stays removable".
import type { Feature } from '../types'
import { getPhotoRow, toPhotoMeta } from '../../photos'
import {
  copiesOf,
  duplicateSummary,
  duplicatesFilter,
  hideDuplicates,
  matchMoves,
  planHide,
  runHashPass
} from './dedupe'
import type { Hasher } from './hash'
import migration from './migrations/100_dedupe.sql?raw'

function id(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new Error(`Invalid id: ${String(v)}`)
  return v
}

export function createDedupeFeature(deps: { hash: Hasher; close?: () => Promise<void> }): Feature {
  // (createWorkerHasher() returns exactly this shape)
  return {
    name: 'dedupe',
    migrations: [{ version: 100, name: 'dedupe', sql: migration }],
    scanHooks: {
      matchMoves: (ctx, added, missing) => matchMoves(ctx.db, ctx.library, deps.hash, added, missing, ctx.signal),
      backgroundPass: {
        label: 'Hashing',
        run: async (ctx) => {
          await runHashPass(ctx.db, ctx.library, deps.hash, { signal: ctx.signal, onProgress: ctx.onProgress })
        }
      }
    },
    filters: { duplicates: duplicatesFilter },
    registerIpc(ipc, { db }) {
      ipc('duplicates:summary', (libraryId) => duplicateSummary(db, id(libraryId)))
      ipc('duplicates:copies', (photoId) =>
        copiesOf(db, id(photoId)).flatMap((pid) => {
          const row = getPhotoRow(db, pid)
          return row ? [toPhotoMeta(row)] : []
        })
      )
      ipc('duplicates:previewHide', (libraryId) => planHide(db, id(libraryId)).length)
      ipc('duplicates:hide', (libraryId) => hideDuplicates(db, id(libraryId)))
    },
    dispose: deps.close
  }
}

import init from './migrations/001_init.sql?raw'
import undo from './migrations/002_undo.sql?raw'
import hidden from './migrations/003_hidden.sql?raw'

export interface Migration {
  /** Core migrations use 1–99; feature migrations use 100+ (enforced by the registry). */
  version: number
  name: string
  sql: string
}

export const CORE_MAX_VERSION = 99

export const coreMigrations: Migration[] = [
  { version: 1, name: 'init', sql: init },
  { version: 2, name: 'undo', sql: undo },
  { version: 3, name: 'hidden', sql: hidden }
]

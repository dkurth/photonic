import init from './migrations/001_init.sql?raw'

export interface Migration {
  /** Core migrations use 1–99; feature migrations use 100+ (enforced by the registry). */
  version: number
  name: string
  sql: string
}

export const CORE_MAX_VERSION = 99

export const coreMigrations: Migration[] = [{ version: 1, name: 'init', sql: init }]

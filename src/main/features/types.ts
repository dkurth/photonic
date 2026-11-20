import type { Migration } from '../db/migrations'
import type { FilterImpl } from '../ordering'
import type { ScanHooks } from '../scanner/types'

/** Registers an IPC handler (wraps ipcMain.handle so features never import electron directly). */
export type IpcRegistrar = (channel: string, handler: (...args: unknown[]) => unknown) => void

/**
 * An optional, removable feature (PLAN.md §8). The core never imports feature code;
 * features plug in through this interface.
 */
export interface Feature {
  name: string
  /** Must use versions >= 100. */
  migrations?: Migration[]
  registerIpc?(ipc: IpcRegistrar): void
  scanHooks?: ScanHooks
  /** Extra view filters, e.g. { duplicates: ... }. */
  filters?: Record<string, FilterImpl>
}

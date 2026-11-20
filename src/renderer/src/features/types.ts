import type { ComponentType } from 'react'
import type { Filter, PhotoMeta, ScanProgress, ViewSpec } from '@shared/types'

/** What the Viewer shares with optional features' UI. */
export interface FeatureContext {
  libraryId: number
  view: ViewSpec
  meta: PhotoMeta | null
  progress: ScanProgress | null
  setFilter: (f: Filter) => void
  /** Rebuild the photo list and counts (e.g. after a bulk action), staying on the current photo. */
  reload: () => Promise<void>
  toast: (msg: string) => void
  /** While a feature's dialog is open, the Viewer's own shortcuts pause. */
  setModalOpen: (open: boolean) => void
}

/** Renderer half of an optional feature (PLAN.md §8). The core only knows this interface. */
export interface RendererFeature {
  name: string
  /** Extra filters, shown after the core ones (key = shortcut). */
  filters?: { id: Filter; key: string; label: string }[]
  /** Always mounted while viewing a library: banners, dialogs, its own shortcuts. */
  Layer?: ComponentType<{ ctx: FeatureContext }>
  /** Small extra info next to the date in the info bar. */
  InfoBadge?: ComponentType<{ ctx: FeatureContext }>
  /** Listed in the keyboard shortcut overlay. */
  shortcuts?: { keys: string[]; label: string }[]
}

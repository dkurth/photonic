import type { RendererFeature } from '../features/types'
import type { FilterDef } from './ViewControls'

/** One of the app's own single-key shortcuts (playlists may take a key over; PLAN.md §12). */
export interface SystemShortcut {
  /** KeyboardEvent.key as matched (see @shared/shortcuts). */
  key: string
  label: string
  group: 'Review' | 'View' | 'Photo & window'
}

/** Every single-key shortcut the app itself uses, for the overlay and for clash detection. */
export function systemShortcuts(filters: FilterDef[], features: RendererFeature[]): SystemShortcut[] {
  return [
    { key: 'ArrowLeft', label: 'Previous photo', group: 'Review' },
    { key: 'ArrowRight', label: 'Next photo', group: 'Review' },
    { key: 'Home', label: 'First photo', group: 'Review' },
    { key: 'End', label: 'Last photo', group: 'Review' },
    { key: 'u', label: 'Back to Unreviewed', group: 'Review' },
    { key: 'Backspace', label: 'Back to Unreviewed', group: 'Review' },
    { key: 'f', label: 'Put a whole folder in a playlist', group: 'Review' },
    ...filters.map((f) => ({ key: f.key, label: `Show ${f.label}`, group: 'View' as const })),
    { key: 's', label: 'Order: filename → date → random', group: 'View' },
    { key: 'r', label: 'Reshuffle (random order)', group: 'View' },
    { key: ' ', label: 'Zoom to 100% (drag to pan)', group: 'View' },
    ...features.flatMap((f) =>
      (f.shortcuts ?? []).map((s) => ({ key: s.key, label: s.label, group: 'View' as const }))
    ),
    { key: 'c', label: 'Copy full path', group: 'Photo & window' },
    { key: 'o', label: 'Show in Finder', group: 'Photo & window' },
    { key: 'h', label: 'Hide / show toolbars', group: 'Photo & window' },
    { key: '?', label: 'Keyboard shortcuts', group: 'Photo & window' }
  ]
}

import { nativeTheme } from 'electron'
import type { Appearance, UiSettings } from '@shared/types'
import { DEFAULT_PALETTE, isPaletteId } from '@shared/palettes'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'

const APPEARANCES: Appearance[] = ['system', 'light', 'dark']

export function readUi(db: DB): UiSettings {
  const theme = getSetting<string>(db, 'ui.theme')
  const appearance = getSetting<Appearance>(db, 'ui.appearance')
  return {
    theme: isPaletteId(theme) ? theme : DEFAULT_PALETTE,
    appearance: appearance && APPEARANCES.includes(appearance) ? appearance : 'system',
    animations: getSetting<boolean>(db, 'ui.animations') ?? true,
    dark: nativeTheme.shouldUseDarkColors
  }
}

export function writeUi(db: DB, patch: Partial<UiSettings>): UiSettings {
  if (patch.theme !== undefined) setSetting(db, 'ui.theme', patch.theme)
  if (patch.appearance !== undefined) setSetting(db, 'ui.appearance', patch.appearance)
  if (patch.animations !== undefined) setSetting(db, 'ui.animations', patch.animations)
  applyAppearance(readUi(db).appearance)
  return readUi(db) // after applying, so `dark` is current
}

/** Light/dark. The renderer is told the effective mode (UiSettings.dark) rather than reading the
 * prefers-color-scheme media query, so there's one source of truth. */
export function applyAppearance(a: Appearance): void {
  nativeTheme.themeSource = a
}

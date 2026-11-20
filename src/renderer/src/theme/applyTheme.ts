import { bestText } from './contrast'
import { NEUTRALS, PALETTES, ROLES, TEXT_DARK, TEXT_LIGHT, type PaletteId } from './palettes'

export type Mode = 'light' | 'dark'

/** All theme colors as CSS custom properties. Components only ever use these var(--…) names. */
export function themeVars(id: PaletteId, mode: Mode): Record<string, string> {
  const palette = PALETTES[id]
  const neutrals = { ...NEUTRALS[mode], ...(mode === 'light' && 'light' in palette ? palette.light : {}) }
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(neutrals)) vars[`--${k}`] = v
  for (const role of ROLES) {
    const fill = palette.roles[role]
    vars[`--${role}`] = fill
    vars[`--on-${role}`] = bestText(fill, TEXT_DARK, TEXT_LIGHT)
  }
  return vars
}

export function applyTheme(id: PaletteId, mode: Mode, el: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(themeVars(id, mode))) el.style.setProperty(k, v)
  el.dataset.mode = mode
  el.dataset.palette = id
}

export function systemMode(): Mode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

import { describe, expect, it } from 'vitest'
import { themeVars } from '../src/renderer/src/theme/applyTheme'
import { contrast, deltaE, hexToRgb } from '../src/renderer/src/theme/contrast'
import { DEFAULT_PALETTE, PALETTES, ROLES, type PaletteId } from '../src/renderer/src/theme/palettes'

const ids = Object.keys(PALETTES) as PaletteId[]

describe('contrast math', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1)
    expect(contrast('#123456', '#123456')).toBeCloseTo(1, 5)
  })
  it('rejects malformed colors', () => {
    expect(() => hexToRgb('#fff')).toThrow()
  })
})

describe('palettes', () => {
  it('default is Arcade', () => {
    expect(DEFAULT_PALETTE).toBe('arcade')
  })

  for (const id of ids) {
    for (const mode of ['light', 'dark'] as const) {
      const v = themeVars(id, mode)

      it(`${id}/${mode}: text on every colored fill meets WCAG AA (4.5:1)`, () => {
        for (const role of ROLES) {
          expect(contrast(v[`--${role}`], v[`--on-${role}`]), `${role}`).toBeGreaterThanOrEqual(4.5)
        }
      })

      it(`${id}/${mode}: body text on paper and surface meets AA`, () => {
        expect(contrast(v['--ink'], v['--paper'])).toBeGreaterThanOrEqual(4.5)
        expect(contrast(v['--ink'], v['--surface'])).toBeGreaterThanOrEqual(4.5)
        expect(contrast(v['--muted'], v['--paper'])).toBeGreaterThanOrEqual(4.5)
      })

      it(`${id}/${mode}: the stage behind photos is a neutral grey`, () => {
        const [r, g, b] = hexToRgb(v['--stage'])
        expect(r).toBe(g)
        expect(g).toBe(b)
      })
    }

    it(`${id}: Like and Meh are clearly different colors`, () => {
      expect(deltaE(PALETTES[id].roles.like, PALETTES[id].roles.meh)).toBeGreaterThan(25)
    })
  }
})

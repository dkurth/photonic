// Color palettes (PLAN.md §12). A palette is 5 colors from coolors.co mapped to roles.
// To add one: paste the hex codes, map them to roles, and run the tests (contrast is checked).

export type Role = 'accent' | 'like' | 'meh' | 'highlight' | 'info'
export const ROLES: Role[] = ['accent', 'like', 'meh', 'highlight', 'info']

export interface Neutrals {
  /** Window background. */
  paper: string
  /** Panels and cards. */
  surface: string
  /** Text, borders and hard shadows. */
  ink: string
  muted: string
  /** Behind the photo: always neutral grey, never tinted (PLAN.md §12). */
  stage: string
  /** Hard drop shadow. */
  shadow: string
}

export interface Palette {
  name: string
  source: string
  roles: Record<Role, string>
  /** Optional light-mode overrides, e.g. a palette whose cream makes a better paper. */
  light?: Partial<Neutrals>
}

/** Text colors used on colored fills; whichever contrasts more is picked per fill. */
export const TEXT_DARK = '#111111'
export const TEXT_LIGHT = '#F4F1EA'

export const NEUTRALS: Record<'light' | 'dark', Neutrals> = {
  light: {
    paper: '#F4F1EA',
    surface: '#FFFFFF',
    ink: '#111111',
    muted: '#5C5A55',
    stage: '#262626',
    shadow: '#111111'
  },
  dark: {
    paper: '#18171B',
    surface: '#232227',
    ink: '#F4F1EA',
    muted: '#A8A49B',
    stage: '#262626',
    shadow: '#000000'
  }
}

export const PALETTES = {
  arcade: {
    name: 'Arcade',
    source: 'https://coolors.co/ef476f-ffd166-06d6a0-118ab2-073b4c',
    roles: { accent: '#FFD166', like: '#EF476F', meh: '#118AB2', highlight: '#06D6A0', info: '#073B4C' }
  },
  desert: {
    name: 'Desert Sunset',
    source: 'https://coolors.co/264653-2a9d8f-e9c46a-f4a261-e76f51',
    roles: { accent: '#E9C46A', like: '#E76F51', meh: '#264653', highlight: '#2A9D8F', info: '#F4A261' }
  },
  pastel: {
    name: 'Pastel Pop',
    source: 'https://coolors.co/cdb4db-ffc8dd-ffafcc-bde0fe-a2d2ff',
    roles: { accent: '#A2D2FF', like: '#FFAFCC', meh: '#BDE0FE', highlight: '#CDB4DB', info: '#FFC8DD' }
  },
  olive: {
    name: 'Olive Grove',
    source: 'https://coolors.co/606c38-283618-fefae0-dda15e-bc6c25',
    roles: { accent: '#DDA15E', like: '#BC6C25', meh: '#606C38', highlight: '#DDA15E', info: '#283618' },
    light: { paper: '#FEFAE0', ink: '#283618', shadow: '#283618' }
  }
} satisfies Record<string, Palette>

export type PaletteId = keyof typeof PALETTES
export const DEFAULT_PALETTE: PaletteId = 'arcade'

export function isPaletteId(v: unknown): v is PaletteId {
  return typeof v === 'string' && v in PALETTES
}

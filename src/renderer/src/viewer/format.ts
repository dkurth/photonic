import type { DateSource, PhotoMeta } from '@shared/types'

export const fmtNumber = (n: number): string => n.toLocaleString('en-US')

/** 'Taken 2019-07-04 14:32' / 'File created 2021-01-10 09:12' (PLAN.md §5). */
export function dateLabel(meta: Pick<PhotoMeta, 'displayDate' | 'dateSource'>): { label: string } {
  const prefix: Record<DateSource, string> = { taken: 'Taken', created: 'File created', modified: 'File modified' }
  return { label: `${prefix[meta.dateSource]} ${meta.displayDate.slice(0, 16)}` }
}

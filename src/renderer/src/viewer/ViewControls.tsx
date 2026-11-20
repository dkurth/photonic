import { useEffect, useState } from 'react'
import type { Filter, SortOrder, StatusCounts, ViewSpec } from '@shared/types'
import { STATUS_LABELS } from '@shared/labels'
import { KeyCap } from '../components/KeyCap'
import { useKeyboard } from '../hooks/useKeyboard'
import { fmtNumber } from './format'

export interface FilterDef {
  id: Filter
  key: string
  label: string
}

export const FILTERS: FilterDef[] = [
  { id: 'all', key: '1', label: 'All' },
  { id: 'unreviewed', key: '2', label: STATUS_LABELS.unreviewed.label },
  { id: 'like', key: '3', label: STATUS_LABELS.like.label },
  { id: 'meh', key: '4', label: STATUS_LABELS.meh.label }
]

export const SORTS: SortOrder[] = ['filename', 'date', 'random']
export const SORT_LABELS: Record<SortOrder, string> = { filename: 'Filename', date: 'Date', random: 'Random' }

export function nextSort(s: SortOrder): SortOrder {
  return SORTS[(SORTS.indexOf(s) + 1) % SORTS.length]
}

export function scopeLabel(view: ViewSpec): string {
  return view.scope.kind === 'folder' ? view.scope.dirPath : 'Entire library'
}

function countFor(id: Filter, counts: StatusCounts | null): number | null {
  if (!counts) return null
  if (id === 'all') return counts.total
  if (id === 'unreviewed') return counts.unreviewed
  if (id === 'like') return counts.like
  if (id === 'meh') return counts.meh
  return null // feature filters (e.g. duplicates) don't have a cheap count
}

/**
 * The current filter as one chip; click it for a dropdown of all filters (core + features).
 * Number keys still switch directly without opening it (PLAN.md §2).
 */
function FilterMenu({
  view,
  filters,
  counts,
  open,
  onOpenChange,
  onFilter
}: {
  view: ViewSpec
  filters: FilterDef[]
  counts: StatusCounts | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onFilter: (f: Filter) => void
}) {
  const current = filters.find((f) => f.id === view.filter) ?? filters[0]
  const [sel, setSel] = useState(0)
  useEffect(() => {
    if (open)
      setSel(
        Math.max(
          0,
          filters.findIndex((f) => f.id === view.filter)
        )
      )
  }, [open, filters, view.filter])

  const choose = (f: FilterDef | undefined): void => {
    onOpenChange(false)
    if (f) onFilter(f.id)
  }

  useKeyboard(
    {
      ArrowDown: () => setSel((i) => Math.min(i + 1, filters.length - 1)),
      ArrowUp: () => setSel((i) => Math.max(i - 1, 0)),
      Enter: () => choose(filters[sel]),
      Escape: () => onOpenChange(false),
      ...Object.fromEntries(filters.map((f) => [f.key, () => choose(f)]))
    },
    open
  )

  return (
    <div className="filter-menu">
      <button
        className={`chip filter ${current.id} ${open ? 'open' : ''}`}
        onClick={() => onOpenChange(!open)}
        onMouseDown={(e) => e.preventDefault()}
        title={`Show: ${current.label} (${filters[0].key}–${filters[filters.length - 1].key} to switch)`}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="filter"
        data-filter={current.id}
      >
        <span className="chip-label">{current.label}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <>
          <div className="popover-backdrop" onMouseDown={() => onOpenChange(false)} />
          <div className="popover" role="listbox" aria-label="Filter">
            {filters.map((f, i) => {
              const n = countFor(f.id, counts)
              return (
                <div
                  key={f.id}
                  role="option"
                  aria-selected={f.id === view.filter}
                  className={`popover-item ${i === sel ? 'selected' : ''} ${f.id === view.filter ? 'current' : ''} ${f.id}`}
                  onMouseEnter={() => setSel(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(f)}
                  data-testid={`filter-option-${f.id}`}
                >
                  <KeyCap k={f.key} />
                  <span className="popover-label">{f.label}</span>
                  {n !== null && <span className="popover-count pixel">{fmtNumber(n)}</span>}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

/** Scope, filter and sort controls in the top bar. Every one has a key (PLAN.md §2). */
export function ViewControls({
  view,
  filters,
  counts,
  filterMenuOpen,
  onFilterMenu,
  pressed,
  onScope,
  onFilter,
  onSort
}: {
  view: ViewSpec
  /** Core filters plus any added by optional features. */
  filters: FilterDef[]
  counts: StatusCounts | null
  filterMenuOpen: boolean
  onFilterMenu: (open: boolean) => void
  pressed: Set<string>
  onScope: () => void
  onFilter: (f: Filter) => void
  onSort: () => void
}) {
  return (
    <div className="view-controls">
      <button
        className={`chip scope ${pressed.has('scope') ? 'pressed' : ''}`}
        onClick={onScope}
        onMouseDown={(e) => e.preventDefault()}
        title="Go to folder (G)"
        data-testid="scope"
      >
        <span className="chip-label">{scopeLabel(view)}</span>
        <KeyCap k="G" />
      </button>
      <FilterMenu
        view={view}
        filters={filters}
        counts={counts}
        open={filterMenuOpen}
        onOpenChange={onFilterMenu}
        onFilter={onFilter}
      />
      <button
        className={`chip sort ${pressed.has('sort') ? 'pressed' : ''}`}
        onClick={onSort}
        onMouseDown={(e) => e.preventDefault()}
        title="Change order (S)"
        data-testid="sort"
      >
        <span className="chip-label">{SORT_LABELS[view.sort]}</span>
        <KeyCap k="S" />
      </button>
    </div>
  )
}

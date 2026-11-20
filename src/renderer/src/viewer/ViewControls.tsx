import type { Filter, SortOrder, ViewSpec } from '@shared/types'
import { STATUS_LABELS } from '@shared/labels'
import { KeyCap } from '../components/KeyCap'

export const FILTERS: { id: Filter; key: string; label: string }[] = [
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

/** Scope, filter and sort controls in the top bar. Every one has a key (PLAN.md §2). */
export function ViewControls({
  view,
  pressed,
  onScope,
  onFilter,
  onSort
}: {
  view: ViewSpec
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
      <div className="segmented" role="radiogroup" aria-label="Filter">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="radio"
            aria-checked={view.filter === f.id}
            className={`seg ${view.filter === f.id ? 'active' : ''} ${f.id}`}
            onClick={() => onFilter(f.id)}
            onMouseDown={(e) => e.preventDefault()}
            title={`${f.label} (${f.key})`}
            data-testid={`filter-${f.id}`}
          >
            <KeyCap k={f.key} />
            <span className="seg-label">{f.label}</span>
          </button>
        ))}
      </div>
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

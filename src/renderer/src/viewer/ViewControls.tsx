import { useEffect, useState, type ReactNode } from 'react'
import type { Filter, Playlist, SortOrder, StatusCounts, ViewSpec } from '@shared/types'
import { playlistEmoticon, playlistTone, UNREVIEWED_LABEL } from '@shared/labels'
import { keyLabel } from '@shared/shortcuts'
import { KeyCap } from '../components/KeyCap'
import { useKeyboard } from '../hooks/useKeyboard'
import { fmtNumber } from './format'

export interface FilterDef {
  id: Filter
  key: string
  label: string
}

/** Core filters. Playlists have their own dropdown; features add more (Duplicates = 3). */
export const FILTERS: FilterDef[] = [
  { id: 'all', key: '1', label: 'All' },
  { id: 'unreviewed', key: '2', label: UNREVIEWED_LABEL }
]

export const SORTS: SortOrder[] = ['filename', 'date', 'random']
export const SORT_LABELS: Record<SortOrder, string> = { filename: 'Filename', date: 'Date', random: 'Random' }

export function nextSort(s: SortOrder): SortOrder {
  return SORTS[(SORTS.indexOf(s) + 1) % SORTS.length]
}

export const playlistFilter = (id: number): Filter => `playlist:${id}`
export function filterPlaylistId(f: Filter): number | null {
  const m = /^playlist:(\d+)$/.exec(f)
  return m ? Number(m[1]) : null
}

function countFor(id: Filter, counts: StatusCounts | null): number | null {
  if (!counts) return null
  if (id === 'all') return counts.total
  if (id === 'unreviewed') return counts.unreviewed
  return null // feature filters (e.g. duplicates) don't have a cheap count
}

interface MenuItem {
  key: string
  /** Shortcut shown as a key cap. */
  cap?: string
  label: ReactNode
  count?: number | null
  current?: boolean
  testId: string
  onChoose: () => void
}

/**
 * A chip that opens a list (PLAN.md §12). While open: ↑/↓ + Enter choose, Esc closes, and
 * `extraKeys` (e.g. the filter number keys) choose directly.
 */
function DropdownChip({
  chip,
  chipClass,
  chipTitle,
  testId,
  value,
  ariaLabel,
  items,
  open,
  onOpenChange,
  extraKeys = {}
}: {
  chip: ReactNode
  chipClass: string
  chipTitle: string
  testId: string
  /** What it currently shows (exposed as data-value, e.g. for tests). */
  value: string
  ariaLabel: string
  items: (MenuItem | 'separator')[]
  open: boolean
  onOpenChange: (open: boolean) => void
  extraKeys?: Record<string, () => void>
}) {
  const choosable = items.filter((i): i is MenuItem => i !== 'separator')
  const [sel, setSel] = useState(0)
  useEffect(() => {
    if (open)
      setSel(
        Math.max(
          0,
          choosable.findIndex((i) => i.current)
        )
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const choose = (item: MenuItem | undefined): void => {
    onOpenChange(false)
    item?.onChoose()
  }

  useKeyboard(
    {
      ArrowDown: () => setSel((i) => Math.min(i + 1, choosable.length - 1)),
      ArrowUp: () => setSel((i) => Math.max(i - 1, 0)),
      Enter: () => choose(choosable[sel]),
      Escape: () => onOpenChange(false),
      ...Object.fromEntries(Object.entries(extraKeys).map(([k, run]) => [k, () => (onOpenChange(false), run())]))
    },
    open
  )

  return (
    <div className="filter-menu">
      <button
        className={`chip ${chipClass} ${open ? 'open' : ''}`}
        onClick={() => onOpenChange(!open)}
        onMouseDown={(e) => e.preventDefault()}
        title={chipTitle}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
        data-value={value}
      >
        {chip}
        <span className="caret">▾</span>
      </button>
      {open && (
        <>
          <div className="popover-backdrop" onMouseDown={() => onOpenChange(false)} />
          <div className="popover" role="listbox" aria-label={ariaLabel}>
            {items.map((item, i) =>
              item === 'separator' ? (
                <div key={`sep-${i}`} className="popover-sep" />
              ) : (
                <div
                  key={item.key}
                  role="option"
                  aria-selected={!!item.current}
                  className={`popover-item ${choosable[sel] === item ? 'selected' : ''} ${item.current ? 'current' : ''}`}
                  onMouseEnter={() => setSel(choosable.indexOf(item))}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(item)}
                  data-testid={item.testId}
                >
                  {item.cap ? <KeyCap k={item.cap} /> : <span className="keycap-space" />}
                  <span className="popover-label">{item.label}</span>
                  {item.count !== undefined && item.count !== null && (
                    <span className="popover-count pixel">{fmtNumber(item.count)}</span>
                  )}
                </div>
              )
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** Filter, playlist and sort controls in the top bar. Every one has a key (PLAN.md §2). */
export function ViewControls({
  view,
  filters,
  playlists,
  counts,
  openMenu,
  onOpenMenu,
  pressed,
  onFilter,
  onManagePlaylists,
  onSort
}: {
  view: ViewSpec
  /** Core filters plus any added by optional features. */
  filters: FilterDef[]
  playlists: Playlist[]
  counts: StatusCounts | null
  openMenu: 'filter' | 'playlists' | null
  onOpenMenu: (menu: 'filter' | 'playlists' | null) => void
  pressed: Set<string>
  onFilter: (f: Filter) => void
  onManagePlaylists: () => void
  onSort: () => void
}) {
  const currentFilter = filters.find((f) => f.id === view.filter)
  const viewing = playlists.find((p) => p.id === filterPlaylistId(view.filter))

  return (
    <div className="view-controls">
      <DropdownChip
        testId="filter"
        value={view.filter}
        ariaLabel="Filter"
        chipClass={`filter ${currentFilter ? currentFilter.id : 'inactive'}`}
        chipTitle={`Show: ${currentFilter?.label ?? 'a playlist'} (${filters.map((f) => f.key).join(', ')} to switch)`}
        chip={<span className="chip-label">{currentFilter?.label ?? 'Filter'}</span>}
        open={openMenu === 'filter'}
        onOpenChange={(o) => onOpenMenu(o ? 'filter' : null)}
        extraKeys={Object.fromEntries(filters.map((f) => [f.key, () => onFilter(f.id)]))}
        items={filters.map((f) => ({
          key: f.id,
          cap: f.key,
          label: f.label,
          count: countFor(f.id, counts),
          current: f.id === view.filter,
          testId: `filter-option-${f.id}`,
          onChoose: () => onFilter(f.id)
        }))}
      />
      <DropdownChip
        testId="playlists"
        value={viewing ? String(viewing.id) : ''}
        ariaLabel="Playlists"
        chipClass={`playlists ${viewing ? playlistTone(viewing) : 'inactive'}`}
        chipTitle={viewing ? `Showing the ${viewing.name} playlist` : 'Playlists'}
        chip={
          <span className="chip-label">
            {viewing ? (
              <>
                {playlistEmoticon(viewing) && <span className="emoticon">{playlistEmoticon(viewing)} </span>}
                {viewing.name}
              </>
            ) : (
              'Playlists'
            )}
          </span>
        }
        open={openMenu === 'playlists'}
        onOpenChange={(o) => onOpenMenu(o ? 'playlists' : null)}
        items={[
          { key: 'manage', label: 'Manage Playlists…', testId: 'manage-playlists', onChoose: onManagePlaylists },
          'separator',
          ...playlists.map((p) => ({
            key: `pl-${p.id}`,
            cap: p.shortcut ? keyLabel(p.shortcut) : undefined,
            label: (
              <>
                {playlistEmoticon(p) && <span className="emoticon">{playlistEmoticon(p)} </span>}
                {p.name}
              </>
            ),
            count: counts ? (counts.byPlaylist[p.id] ?? 0) : null,
            current: viewing?.id === p.id,
            testId: `playlist-option-${p.id}`,
            onChoose: () => onFilter(playlistFilter(p.id))
          }))
        ]}
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

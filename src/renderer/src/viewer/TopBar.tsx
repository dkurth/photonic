import type { ReactNode } from 'react'
import type { Library, ScanProgress } from '@shared/types'
import { Button } from '../components/Button'
import { Logo } from '../components/Logo'
import { fmtNumber } from './format'

function scanStatus(p: ScanProgress | null): string | null {
  if (!p) return null
  if (p.phase === 'walking') return `Scanning… ${fmtNumber(p.found)}`
  if (p.phase === 'metadata' && p.metaTotal > 0) {
    return `Reading dates… ${Math.floor((100 * p.metaDone) / p.metaTotal)}%`
  }
  if (p.phase === 'tasks' && p.taskLabel) {
    return p.taskTotal ? `${p.taskLabel}… ${Math.floor((100 * (p.taskDone ?? 0)) / p.taskTotal)}%` : `${p.taskLabel}…`
  }
  if (p.phase === 'error') return `Scan failed: ${p.message ?? ''}`
  return null
}

export function TopBar({
  library,
  progress,
  controls,
  onOpenFolder,
  onSwitchLibrary
}: {
  library: Library
  progress: ScanProgress | null
  controls?: ReactNode
  onOpenFolder: () => void
  onSwitchLibrary: () => void
}) {
  const status = scanStatus(progress)
  return (
    <header className="topbar">
      <Logo size={16} />
      <span className="divider" />
      <button
        className="library-name"
        title={`${library.rootPath} — switch library (⌘L)`}
        onClick={onSwitchLibrary}
        onMouseDown={(e) => e.preventDefault()}
        data-testid="library-name"
      >
        {library.name} <span className="caret">▾</span>
      </button>
      {controls}
      <span className="spacer" />
      {status && (
        <span className={`scan-status ${progress?.phase === 'error' ? 'error' : ''}`} role="status">
          {status}
        </span>
      )}
      <Button size="small" keys={['⌘O']} onClick={onOpenFolder} title="Open another folder">
        <span className="open-label">Open folder…</span>
      </Button>
    </header>
  )
}

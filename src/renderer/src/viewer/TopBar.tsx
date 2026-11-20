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
  if (p.phase === 'error') return `Scan failed: ${p.message ?? ''}`
  return null
}

export function TopBar({
  library,
  progress,
  onOpenFolder
}: {
  library: Library
  progress: ScanProgress | null
  onOpenFolder: () => void
}) {
  const status = scanStatus(progress)
  return (
    <header className="topbar">
      <Logo size={16} />
      <span className="divider" />
      <span className="library-name" title={library.rootPath}>
        {library.name}
      </span>
      <span className="spacer" />
      {status && (
        <span className={`scan-status ${progress?.phase === 'error' ? 'error' : ''}`} role="status">
          {status}
        </span>
      )}
      <Button size="small" keys={['⌘O']} onClick={onOpenFolder} title="Open another folder">
        Open folder…
      </Button>
    </header>
  )
}

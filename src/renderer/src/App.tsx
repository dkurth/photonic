import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/types'

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.photonic.app.info().then(setInfo, (e: unknown) => setError(String(e)))
  }, [])

  return (
    <main className="m0">
      <h1>PHOTONIC</h1>
      {error && <p className="err">{error}</p>}
      {info && (
        <dl>
          <dt>Version</dt>
          <dd>{info.version} (Electron {info.electron})</dd>
          <dt>Database</dt>
          <dd>{info.dbPath}</dd>
          <dt>Schema</dt>
          <dd>v{info.schemaVersion}</dd>
          <dt>Features</dt>
          <dd>{info.features.length ? info.features.join(', ') : 'none'}</dd>
          <dt>Last backup</dt>
          <dd>{info.lastBackup ?? 'none yet'}</dd>
        </dl>
      )}
    </main>
  )
}

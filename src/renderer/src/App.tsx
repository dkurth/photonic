import { useCallback, useEffect, useState } from 'react'
import type { Library, LibraryStats, ScanProgress } from '@shared/types'

// Temporary M1 screen: open a folder, watch the scan, see what was found. The viewer replaces it in M2.

const n = (v: number): string => v.toLocaleString()

function describe(p: ScanProgress | null): string {
  if (!p) return 'Idle'
  switch (p.phase) {
    case 'walking':
      return `Scanning… ${n(p.found)} photos found`
    case 'metadata':
      return p.metaTotal ? `Reading dates… ${n(p.metaDone)} / ${n(p.metaTotal)}` : 'Reading dates…'
    case 'done':
      return `Up to date: ${n(p.found)} photos (${n(p.added)} new, ${n(p.changed)} changed, ${n(p.missing)} newly missing)`
    case 'error':
      return `Scan failed: ${p.message ?? 'unknown error'}`
  }
}

export default function App() {
  const api = window.photonic.libraries
  const [library, setLibrary] = useState<Library | null>(null)
  const [libraries, setLibraries] = useState<Library[]>([])
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(
    async (lib: Library | null) => {
      setLibraries(await api.list())
      setStats(lib ? await api.stats(lib.id) : null)
    },
    [api]
  )

  const openLibrary = useCallback(
    async (open: () => Promise<Library | null>) => {
      try {
        setError(null)
        const lib = await open()
        if (!lib) return
        setLibrary(lib)
        setProgress(null)
        await refresh(lib)
      } catch (e) {
        setError(String(e))
      }
    },
    [refresh]
  )

  // Reopen the last library on launch.
  useEffect(() => {
    void api.last().then((lib) => (lib ? openLibrary(() => api.open(lib.id)) : refresh(null)))
  }, [api, openLibrary, refresh])

  useEffect(
    () =>
      api.onProgress((p) => {
        if (p.libraryId !== library?.id) return
        setProgress(p)
        void api.stats(p.libraryId).then(setStats)
      }),
    [api, library]
  )

  return (
    <main className="m1">
      <header>
        <h1>PHOTONIC</h1>
        <button className="btn" onClick={() => openLibrary(api.pickAndOpen)}>
          Open a folder…
        </button>
      </header>

      {error && <p className="err">{error}</p>}

      {!library && <p className="hint">Choose a folder of photos to get started. Subfolders are included.</p>}

      {library && (
        <section className="card">
          <div className="card-head">
            <h2>{library.name}</h2>
            <button className="btn small" onClick={() => api.rescan(library.id)}>
              Rescan
            </button>
          </div>
          <p className="path">{library.rootPath}</p>
          <p className="status" data-phase={progress?.phase ?? 'idle'}>
            {describe(progress)}
            {progress && progress.unreadableFolders > 0 && ` · ${progress.unreadableFolders} folders unreadable`}
          </p>
          {stats && (
            <dl>
              <dt>Photos</dt>
              <dd>{n(stats.total)}</dd>
              <dt>Folders</dt>
              <dd>{n(stats.folders)}</dd>
              <dt>Unreviewed</dt>
              <dd>{n(stats.unreviewed)}</dd>
              <dt>Dates read</dt>
              <dd>
                {n(stats.metaRead)} ({n(stats.withTakenAt)} with a capture date)
              </dd>
              <dt>Missing</dt>
              <dd>{n(stats.missing)}</dd>
            </dl>
          )}
        </section>
      )}

      {libraries.filter((l) => l.id !== library?.id).length > 0 && (
        <section className="others">
          <h3>Other libraries</h3>
          <ul>
            {libraries
              .filter((l) => l.id !== library?.id)
              .map((l) => (
                <li key={l.id}>
                  <button className="link" onClick={() => openLibrary(() => api.open(l.id))}>
                    {l.name}
                  </button>
                  <span className="path">{l.rootPath}</span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </main>
  )
}

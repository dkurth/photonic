import { useCallback, useEffect, useState } from 'react'
import type { Library, ScanProgress } from '@shared/types'
import { useKeyboard } from './hooks/useKeyboard'
import { RENDERER_FEATURES } from './features'
import type { RendererFeature } from './features/types'
import { applyTheme, systemMode } from './theme/applyTheme'
import { DEFAULT_PALETTE, isPaletteId, type PaletteId } from './theme/palettes'
import { Viewer } from './viewer/Viewer'
import { Welcome } from './Welcome'

export default function App() {
  const api = window.photonic
  const [library, setLibrary] = useState<Library | null>(null)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [palette, setPalette] = useState<PaletteId>(DEFAULT_PALETTE)
  const [error, setError] = useState<string | null>(null)
  const [features, setFeatures] = useState<RendererFeature[]>([])

  useEffect(() => {
    void api.features.enabled().then((on) => setFeatures(RENDERER_FEATURES.filter((f) => on.includes(f.name))))
  }, [api])

  // Theme: saved palette + follow the system light/dark setting.
  useEffect(() => {
    void api.settings.get<string>('ui.theme').then((t) => isPaletteId(t) && setPalette(t))
  }, [api])
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => applyTheme(palette, systemMode())
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [palette])

  const open = useCallback(async (opener: () => Promise<Library | null>) => {
    try {
      setError(null)
      const lib = await opener()
      if (lib) {
        setProgress(null)
        setLibrary(lib)
      }
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const openFolder = useCallback(() => void open(api.libraries.pickAndOpen), [api, open])

  // Reopen the last library on launch.
  useEffect(() => {
    void api.libraries
      .last()
      .then((lib) => (lib ? open(() => api.libraries.open(lib.id)) : undefined))
      .finally(() => setReady(true))
  }, [api, open])

  useEffect(() => api.libraries.onProgress(setProgress), [api])

  useEffect(
    () =>
      api.onMenu((cmd) => {
        if (cmd === 'open-folder') openFolder()
        if (cmd === 'rescan' && library) void api.libraries.rescan(library.id)
      }),
    [api, library, openFolder]
  )

  useKeyboard({ 'Mod+o': openFolder })

  if (!ready) return null
  return (
    <>
      {library ? (
        <Viewer
          key={library.id}
          library={library}
          progress={progress?.libraryId === library.id ? progress : null}
          features={features}
          onOpenFolder={openFolder}
        />
      ) : (
        <Welcome onOpenFolder={openFolder} onOpen={(id) => void open(() => api.libraries.open(id))} />
      )}
      {error && <div className="toast error">{error}</div>}
    </>
  )
}

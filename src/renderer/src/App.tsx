import { useCallback, useEffect, useRef, useState } from 'react'
import type { Library, ScanProgress, UiSettings } from '@shared/types'
import { DEFAULT_PALETTE, isPaletteId } from '@shared/palettes'
import { RENDERER_FEATURES } from './features'
import type { RendererFeature } from './features/types'
import { LibrarySwitcher } from './LibrarySwitcher'
import { applyTheme } from './theme/applyTheme'
import { Viewer } from './viewer/Viewer'
import { Welcome } from './Welcome'

const DEFAULT_UI: UiSettings = { theme: DEFAULT_PALETTE, appearance: 'system', animations: true, dark: false }

export default function App() {
  const api = window.photonic
  const [library, setLibrary] = useState<Library | null>(null)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [ui, setUi] = useState<UiSettings>(DEFAULT_UI)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [features, setFeatures] = useState<RendererFeature[]>([])

  useEffect(() => {
    void api.features.enabled().then((on) => setFeatures(RENDERER_FEATURES.filter((f) => on.includes(f.name))))
  }, [api])

  // UI settings (View menu): palette, light/dark, animations.
  useEffect(() => {
    void api.app.ui().then(setUi)
    return api.app.onUiChanged(setUi)
  }, [api])
  useEffect(() => {
    applyTheme(isPaletteId(ui.theme) ? ui.theme : DEFAULT_PALETTE, ui.dark ? 'dark' : 'light')
  }, [ui.theme, ui.dark])
  useEffect(() => {
    document.documentElement.dataset.animations = ui.animations ? 'on' : 'off'
  }, [ui.animations])

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

  // ⌘O comes from the File menu's accelerator; still, only one folder dialog at a time.
  const picking = useRef(false)
  const openFolder = useCallback(() => {
    if (picking.current) return
    picking.current = true
    setSwitcherOpen(false)
    void open(api.libraries.pickAndOpen).finally(() => (picking.current = false))
  }, [api, open])

  const openLibrary = useCallback(
    (id: number) => {
      setSwitcherOpen(false)
      void open(() => api.libraries.open(id))
    },
    [api, open]
  )

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
        if (cmd === 'switch-library') setSwitcherOpen(true)
        if (cmd === 'rescan' && library) void api.libraries.rescan(library.id)
      }),
    [api, library, openFolder]
  )

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
          onSwitchLibrary={() => setSwitcherOpen(true)}
        />
      ) : (
        <Welcome onOpenFolder={openFolder} onOpen={openLibrary} />
      )}
      {switcherOpen && (
        <LibrarySwitcher
          currentId={library?.id ?? null}
          onOpen={openLibrary}
          onOpenFolder={openFolder}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
      {error && <div className="toast error">{error}</div>}
    </>
  )
}

import { useEffect, useState } from 'react'
import type { Library } from '@shared/types'
import { STATUS_LABELS } from '@shared/labels'
import { Button } from './components/Button'
import { Logo } from './components/Logo'

export function Welcome({ onOpenFolder, onOpen }: { onOpenFolder: () => void; onOpen: (id: number) => void }) {
  const [libraries, setLibraries] = useState<Library[]>([])
  useEffect(() => {
    void window.photonic.libraries.list().then(setLibraries)
  }, [])

  return (
    <main className="welcome">
      <div className="welcome-inner">
        <Logo size={48} />
        <p className="tagline">
          <span>
            Like it <span className="emoticon">{STATUS_LABELS.like.emoticon}</span>
          </span>
          <span>
            Meh it <span className="emoticon">{STATUS_LABELS.meh.emoticon}</span>
          </span>
          <span>Move on.</span>
        </p>
        <Button variant="accent" size="big" keys={['⌘O']} onClick={onOpenFolder}>
          Open a folder…
        </Button>
        <p className="hint">Choose a folder of photos to get started. Subfolders are included.</p>
        {libraries.length > 0 && (
          <section className="recent">
            <h3>Recent</h3>
            {libraries.map((l) => (
              <button key={l.id} className="recent-item" onClick={() => onOpen(l.id)}>
                <strong>{l.name}</strong>
                <span className="mono">{l.rootPath}</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </main>
  )
}

/** A tiny raised key. Symbols the pixel font lacks (⌘ ⇧ ⌥) are drawn in the UI font. */
export function KeyCap({ k, title }: { k: string; title?: string }) {
  const parts = k.split(/([⌘⇧⌥⌃])/).filter(Boolean)
  return (
    <kbd className="keycap" title={title}>
      {parts.map((p, i) =>
        /^[⌘⇧⌥⌃]$/.test(p) ? (
          <span key={i} className="keycap-sym">
            {p}
          </span>
        ) : (
          p
        )
      )}
    </kbd>
  )
}

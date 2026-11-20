// Pixel-art "skip to start / end" icons (|◀ and ▶|), drawn on a 7×7 grid like the rest of the UI.

const FIRST = ['X....XX', 'X...XXX', 'X..XXXX', 'X.XXXXX', 'X..XXXX', 'X...XXX', 'X....XX']

export function SkipIcon({ to, size = 2 }: { to: 'first' | 'last'; size?: number }) {
  const rows = to === 'first' ? FIRST : FIRST.map((r) => [...r].reverse().join(''))
  return (
    <svg
      width={7 * size}
      height={7 * size}
      viewBox="0 0 7 7"
      shapeRendering="crispEdges"
      aria-hidden
      fill="currentColor"
    >
      {rows.flatMap((row, y) =>
        [...row].map((c, x) => (c === 'X' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null))
      )}
    </svg>
  )
}

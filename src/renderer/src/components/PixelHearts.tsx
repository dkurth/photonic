// A little burst of pixel-art hearts for a Like (PLAN.md §12).

const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...']

function PixelHeart({ size }: { size: number }) {
  return (
    <svg width={size * 7} height={size * 6} viewBox="0 0 7 6" shapeRendering="crispEdges" aria-hidden>
      {HEART.flatMap((row, y) =>
        [...row].map((c, x) => (c === 'X' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null))
      )}
    </svg>
  )
}

// Fixed "random" spread so the burst looks lively but tests and screenshots stay stable.
const SPREAD = [
  { dx: -70, delay: 0, size: 4 },
  { dx: -30, delay: 40, size: 3 },
  { dx: 10, delay: 10, size: 5 },
  { dx: 50, delay: 60, size: 3 },
  { dx: 85, delay: 25, size: 4 }
]

export function PixelHearts() {
  return (
    <div className="pixel-hearts" aria-hidden>
      {SPREAD.map((h, i) => (
        <span key={i} style={{ ['--dx' as string]: `${h.dx}px`, animationDelay: `${h.delay}ms` }}>
          <PixelHeart size={h.size} />
        </span>
      ))}
    </div>
  )
}

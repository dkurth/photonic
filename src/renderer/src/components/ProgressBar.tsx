/** Chunky segmented bar, like a game's health/XP bar (PLAN.md §12). */
export function ProgressBar({ value, total, segments = 20 }: { value: number; total: number; segments?: number }) {
  const filled = total > 0 ? Math.round((value / total) * segments) : 0
  const pct = total > 0 ? Math.round((100 * value) / total) : 0
  return (
    <div
      className="xp-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
      title={`${pct}% reviewed`}
      data-testid="progress"
    >
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={i < filled ? 'on' : ''} />
      ))}
    </div>
  )
}

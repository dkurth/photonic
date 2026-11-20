import { Button } from '../components/Button'
import { fmtNumber } from './format'

export function Toolbar({
  index,
  total,
  pressed,
  onPrev,
  onNext
}: {
  index: number
  total: number
  pressed: Set<string>
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <footer className="toolbar">
      <div className="position pixel" data-testid="position">
        {total ? `${fmtNumber(index + 1)} / ${fmtNumber(total)}` : '0 / 0'}
      </div>
      <div className="controls">
        <Button keys={['←']} pressed={pressed.has('prev')} disabled={index <= 0} onClick={onPrev} title="Previous photo">
          Prev
        </Button>
        <Button keys={['→']} pressed={pressed.has('next')} disabled={index >= total - 1} onClick={onNext} title="Next photo">
          Next
        </Button>
      </div>
      <div className="toolbar-right" />
    </footer>
  )
}

import type { ReactNode } from 'react'
import { KeyCap } from './KeyCap'

export interface ButtonProps {
  children?: ReactNode
  /** Keyboard shortcut(s) to show as key caps. */
  keys?: string[]
  variant?: 'plain' | 'accent' | 'like' | 'meh'
  size?: 'small' | 'normal' | 'big'
  /** Shows the sunk-in state; set briefly when the matching key is pressed. */
  pressed?: boolean
  disabled?: boolean
  title?: string
  /** Accessible name for icon-only buttons. */
  ariaLabel?: string
  className?: string
  onClick?: () => void
}

/** Raised button with a hard shadow that sinks when pressed (PLAN.md §12). */
export function Button({
  children,
  keys,
  variant = 'plain',
  size = 'normal',
  pressed,
  disabled,
  title,
  ariaLabel,
  className,
  onClick
}: ButtonProps) {
  const cls = ['btn', variant !== 'plain' && variant, size !== 'normal' && size, pressed && 'pressed', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      type="button"
      className={cls}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      tabIndex={-1}
      // Don't take focus on click: a focused button would also be "clicked" by Enter/Space,
      // which are keyboard shortcuts here.
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
      {keys?.map((k) => (
        <KeyCap key={k} k={k} />
      ))}
    </button>
  )
}

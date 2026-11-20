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
  className?: string
  onClick?: () => void
}

/** Raised button with a hard shadow that sinks when pressed (PLAN.md §12). */
export function Button({ children, keys, variant = 'plain', size = 'normal', pressed, disabled, title, className, onClick }: ButtonProps) {
  const cls = ['btn', variant !== 'plain' && variant, size !== 'normal' && size, pressed && 'pressed', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" className={cls} disabled={disabled} title={title} onClick={onClick} tabIndex={-1}>
      {children}
      {keys?.map((k) => <KeyCap key={k} k={k} />)}
    </button>
  )
}

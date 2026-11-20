import { useCallback, useEffect, useRef, useState } from 'react'

/** Briefly marks an on-screen button as pressed, so keyboard presses visibly push it (PLAN.md §12). */
export function usePressed(ms = 120): [Set<string>, (id: string) => void] {
  const [pressed, setPressed] = useState<Set<string>>(new Set())
  const timers = useRef(new Map<string, number>())

  const press = useCallback(
    (id: string) => {
      window.clearTimeout(timers.current.get(id))
      setPressed((s) => new Set(s).add(id))
      timers.current.set(
        id,
        window.setTimeout(() => {
          setPressed((s) => {
            const n = new Set(s)
            n.delete(id)
            return n
          })
        }, ms)
      )
    },
    [ms]
  )

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  return [pressed, press]
}

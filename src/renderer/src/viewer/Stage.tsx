import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PhotoMeta, Status } from '@shared/types'

/** The last mark made, for the toolbar button's wiggle. */
export interface Flash {
  status: Status
  /** Increments on every mark, so marking the same way twice still re-triggers the wiggle. */
  n: number
}

interface Natural {
  id: number
  w: number
  h: number
}

const clamp = (v: number, max: number): number => Math.max(-max, Math.min(max, v))

/**
 * The photo, on a neutral grey "screen" with a thick ink frame (PLAN.md §12).
 * `zoomed` shows it at 100% (one image pixel per screen pixel); drag to pan.
 */
export function Stage({
  meta,
  standby = [],
  empty,
  zoomed = false,
  overlay
}: {
  meta: PhotoMeta | null
  /** Photos likely to come next: rendered invisibly at full size so they're decoded and ready. */
  standby?: PhotoMeta[]
  empty: string | null
  zoomed?: boolean
  overlay?: ReactNode
}) {
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set())
  const naturals = useRef(new Map<number, Natural>())
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const currentFailed = !!meta && (meta.missing || failed.has(meta.id))
  const natural = meta ? naturals.current.get(meta.id) : undefined

  useEffect(() => setPan({ x: 0, y: 0 }), [zoomed, meta?.id])

  // 100% size in CSS pixels, and how far it can be dragged before an edge comes into view.
  let zoom: { w: number; h: number; maxX: number; maxY: number } | null = null
  if (zoomed && meta && natural && stageRef.current) {
    const dpr = window.devicePixelRatio || 1
    const w = natural.w / dpr
    const h = natural.h / dpr
    zoom = {
      w,
      h,
      maxX: Math.max(0, (w - stageRef.current.clientWidth) / 2),
      maxY: Math.max(0, (h - stageRef.current.clientHeight) / 2)
    }
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!zoom) return
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!zoom || !drag.current) return
    const d = drag.current
    setPan({ x: clamp(d.px + e.clientX - d.x, zoom.maxX), y: clamp(d.py + e.clientY - d.y, zoom.maxY) })
  }
  const endDrag = (): void => {
    drag.current = null
  }

  return (
    <div className="stage-wrap">
      <div
        ref={stageRef}
        className={`stage ${zoom ? 'zoomed' : ''}`}
        data-testid="stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* The current photo plus the standby ones, one <img> each, in a stable order: moving to a
            standby photo just makes its already-decoded element visible. */}
        {[...new Map([...(meta && !currentFailed ? [meta] : []), ...standby].map((m) => [m.id, m])).values()]
          .filter((m) => !m.missing && !failed.has(m.id))
          .sort((a, b) => a.id - b.id)
          .map((m) => {
            const isCurrent = m.id === meta?.id
            return (
              <img
                key={`photo-${m.id}`}
                className={isCurrent ? 'current' : 'standby'}
                src={m.url}
                alt={isCurrent ? m.relPath : ''}
                aria-hidden={!isCurrent}
                draggable={false}
                decoding="async"
                onLoad={(e) => {
                  // Invisible images aren't decoded until shown; ask for it now so the switch is instant.
                  if (!isCurrent) void e.currentTarget.decode().catch(() => {})
                  naturals.current.set(m.id, {
                    id: m.id,
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight
                  })
                }}
                onError={() => setFailed((f) => new Set(f).add(m.id))}
                style={
                  isCurrent && zoom
                    ? {
                        width: zoom.w,
                        height: zoom.h,
                        left: `calc(50% - ${zoom.w / 2}px + ${clamp(pan.x, zoom.maxX)}px)`,
                        top: `calc(50% - ${zoom.h / 2}px + ${clamp(pan.y, zoom.maxY)}px)`
                      }
                    : undefined
                }
              />
            )
          })}
        {meta && currentFailed && (
          <div className="stage-message">
            <div className="pixel big">?!</div>
            <div>{meta.missing ? "This file isn't there anymore." : "Can't display this file."}</div>
            <div className="mono">{meta.absPath}</div>
          </div>
        )}
        {!meta && empty && (
          <div className="stage-message">
            <div>{empty}</div>
          </div>
        )}
        {zoom && <div className="zoom-badge pixel">100%</div>}
        {overlay}
      </div>
    </div>
  )
}

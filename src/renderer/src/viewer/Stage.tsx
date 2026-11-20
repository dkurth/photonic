import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PhotoMeta, Status } from '@shared/types'
import { STATUS_LABELS } from '@shared/labels'
import { PixelHearts } from '../components/PixelHearts'

export interface Flash {
  status: Status
  /** Increments on every mark, so the same status twice still re-triggers the animation. */
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
  empty,
  flash,
  zoomed = false,
  overlay
}: {
  meta: PhotoMeta | null
  empty: string | null
  flash: Flash | null
  zoomed?: boolean
  overlay?: ReactNode
}) {
  const [failedId, setFailedId] = useState<number | null>(null)
  const [natural, setNatural] = useState<Natural | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const failed = meta && (meta.missing || failedId === meta.id)

  useEffect(() => setPan({ x: 0, y: 0 }), [zoomed, meta?.id])

  // 100% size in CSS pixels, and how far it can be dragged before an edge comes into view.
  let zoom: { w: number; h: number; maxX: number; maxY: number } | null = null
  if (zoomed && meta && natural?.id === meta.id && stageRef.current) {
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
        {meta && !failed && (
          <img
            key={`photo-${meta.id}`}
            src={meta.url}
            alt={meta.relPath}
            draggable={false}
            onLoad={(e) =>
              setNatural({ id: meta.id, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            onError={() => setFailedId(meta.id)}
            style={
              zoom
                ? {
                    width: zoom.w,
                    height: zoom.h,
                    left: `calc(50% - ${zoom.w / 2}px + ${clamp(pan.x, zoom.maxX)}px)`,
                    top: `calc(50% - ${zoom.h / 2}px + ${clamp(pan.y, zoom.maxY)}px)`
                  }
                : undefined
            }
          />
        )}
        {meta && failed && (
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
        {flash && (
          <div key={`flash-${flash.n}`} className={`mark-flash ${flash.status}`} aria-hidden>
            {STATUS_LABELS[flash.status].emoticon && (
              <span className="mark-flash-badge">{STATUS_LABELS[flash.status].emoticon}</span>
            )}
            {flash.status === 'like' && <PixelHearts />}
          </div>
        )}
        {zoom && <div className="zoom-badge pixel">100%</div>}
        {overlay}
      </div>
    </div>
  )
}

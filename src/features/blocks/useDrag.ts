/**
 * Drag-and-drop of tray pieces onto the board with Pointer Events (mouse, pen
 * and touch). The dragged piece follows the pointer at board size; on touch it
 * floats above the finger so it stays visible. The drop snaps to the nearest cell.
 */
import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import { GRID_SIZE, type Shape } from '../../lib/blocks'

const DRAG_THRESHOLD = 6

export interface DragState {
  slot: number
  /** Snapped top-left cell while the piece is over the board, else null. */
  anchor: { row: number; col: number } | null
  /** Board cell size and gap in px (the ghost is drawn at board size). */
  cell: number
  gap: number
}

interface Pointer {
  id: number
  slot: number
  startX: number
  startY: number
  x: number
  y: number
  /** Where the piece was grabbed (0–1 of its width/height); used for mouse and pen. */
  fx: number
  fy: number
  touch: boolean
  dragging: boolean
  left: number
  top: number
}

interface Options {
  boardRef: RefObject<HTMLElement | null>
  ghostRef: RefObject<HTMLElement | null>
  shapeOf: (slot: number) => Shape | null
  onStart: (slot: number) => void
  onDrop: (slot: number, row: number, col: number) => void
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export function usePieceDrag({ boardRef, ghostRef, shapeOf, onStart, onDrop }: Options) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const pointer = useRef<Pointer | null>(null)
  const suppressClick = useRef(false)
  const latest = useRef({ shapeOf, onStart, onDrop })
  latest.current = { shapeOf, onStart, onDrop }

  const locate = useCallback(
    (p: Pointer, shape: Shape) => {
      const cells = boardRef.current?.querySelectorAll<HTMLElement>('[data-cell]')
      if (!cells || cells.length < GRID_SIZE * GRID_SIZE) return null
      const first = cells[0].getBoundingClientRect()
      const last = cells[cells.length - 1].getBoundingClientRect()
      const pitchX = (last.left - first.left) / (GRID_SIZE - 1)
      const pitchY = (last.top - first.top) / (GRID_SIZE - 1)
      const cell = first.width
      const gap = pitchX - cell
      const w = shape.cols * pitchX - gap
      const h = shape.rows * pitchY - gap
      const left = p.touch ? p.x - w / 2 : p.x - p.fx * w
      const top = p.touch ? p.y - h - Math.max(28, pitchY) : p.y - p.fy * h
      const row = Math.round((top - first.top) / pitchY)
      const col = Math.round((left - first.left) / pitchX)
      const over = row + shape.rows > 0 && row < GRID_SIZE && col + shape.cols > 0 && col < GRID_SIZE
      return { left, top, cell, gap, anchor: over ? { row, col } : null }
    },
    [boardRef],
  )

  const moveGhost = useCallback(() => {
    const p = pointer.current
    if (p && ghostRef.current) ghostRef.current.style.transform = `translate3d(${p.left}px, ${p.top}px, 0)`
  }, [ghostRef])

  // Position the ghost before its first paint.
  useLayoutEffect(() => {
    if (drag) moveGhost()
  }, [drag, moveGhost])

  const cancel = useCallback(() => {
    pointer.current = null
    setDrag(null)
  }, [])

  const bind = (slot: number) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (!latest.current.shapeOf(slot)) return
      const box = (e.currentTarget.querySelector('[data-piece]') ?? e.currentTarget).getBoundingClientRect()
      pointer.current = {
        id: e.pointerId,
        slot,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        fx: box.width ? clamp01((e.clientX - box.left) / box.width) : 0.5,
        fy: box.height ? clamp01((e.clientY - box.top) / box.height) : 0.5,
        touch: e.pointerType === 'touch',
        dragging: false,
        left: 0,
        top: 0,
      }
      suppressClick.current = false
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // Capture is best-effort (e.g. the pointer is already gone).
      }
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const p = pointer.current
      if (!p || p.id !== e.pointerId) return
      p.x = e.clientX
      p.y = e.clientY
      if (!p.dragging) {
        if (Math.hypot(p.x - p.startX, p.y - p.startY) < DRAG_THRESHOLD) return
        p.dragging = true
        latest.current.onStart(p.slot)
      }
      const shape = latest.current.shapeOf(p.slot)
      const at = shape && locate(p, shape)
      if (!at) return
      p.left = at.left
      p.top = at.top
      moveGhost()
      setDrag((d) =>
        d && d.slot === p.slot && d.cell === at.cell && d.anchor?.row === at.anchor?.row && d.anchor?.col === at.anchor?.col
          ? d
          : { slot: p.slot, anchor: at.anchor, cell: at.cell, gap: at.gap },
      )
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const p = pointer.current
      if (!p || p.id !== e.pointerId) return
      pointer.current = null
      if (!p.dragging) return
      suppressClick.current = true
      setDrag(null)
      const shape = latest.current.shapeOf(p.slot)
      const at = shape && locate(p, shape)
      if (at?.anchor) latest.current.onDrop(p.slot, at.anchor.row, at.anchor.col)
    },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => {
      if (pointer.current?.id === e.pointerId) cancel()
    },
    onLostPointerCapture: (e: PointerEvent<HTMLElement>) => {
      if (pointer.current?.id === e.pointerId) cancel()
    },
  })

  /** True for the click that browsers fire after a drag ends (it shouldn't select the piece). */
  const isDragClick = (e: MouseEvent) => {
    if (!suppressClick.current || e.detail === 0) return false
    suppressClick.current = false
    return true
  }

  return { drag, bind, cancel, isDragClick }
}

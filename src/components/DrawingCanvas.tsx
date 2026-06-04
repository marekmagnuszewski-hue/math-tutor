import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react'

const PEN_SIZES = { small: 2.4, medium: 4.5, large: 8 }

interface Props {
  tool: 'pen' | 'erase'
  penColor: string
  penSize: 'small' | 'medium' | 'large'
  onFirstDraw: () => void
  onUndoStackChange: (canUndo: boolean) => void
}

export interface CanvasHandle {
  getImageBase64: () => string
  clear: (snapshot?: boolean) => void
  undo: () => void
}

const DrawingCanvas = forwardRef<CanvasHandle, Props>(
  ({ tool, penColor, penSize, onFirstDraw, onUndoStackChange }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const wrapRef = useRef<HTMLDivElement>(null)
    const undoStack = useRef<ImageData[]>([])
    const drawing = useRef(false)
    const lastPt = useRef<{ x: number; y: number } | null>(null)
    const lastMid = useRef<{ x: number; y: number } | null>(null)
    const hasDrawn = useRef(false)
    const dpr = useRef(1)
    const toolRef = useRef(tool)
    const colorRef = useRef(penColor)
    const sizeRef = useRef(penSize)
    const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

    // Keep refs in sync
    useEffect(() => { toolRef.current = tool }, [tool])
    useEffect(() => { colorRef.current = penColor }, [penColor])
    useEffect(() => { sizeRef.current = penSize }, [penSize])

    const refreshUndo = useCallback(() => {
      onUndoStackChange(undoStack.current.length > 0)
    }, [onUndoStackChange])

    const snapshot = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      try {
        undoStack.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
        if (undoStack.current.length > 30) undoStack.current.shift()
      } catch { /* ignore */ }
      refreshUndo()
    }, [refreshUndo])

    const fitCanvas = useCallback(() => {
      const canvas = canvasRef.current
      const wrap = wrapRef.current
      if (!canvas || !wrap) return
      const rect = wrap.getBoundingClientRect()
      if (rect.width === 0) return

      // preserve existing art
      const tmp = document.createElement('canvas')
      tmp.width = canvas.width; tmp.height = canvas.height
      if (canvas.width) tmp.getContext('2d')!.drawImage(canvas, 0, 0)

      dpr.current = window.devicePixelRatio || 1
      canvas.width = Math.round(rect.width * dpr.current)
      canvas.height = Math.round(rect.height * dpr.current)
      canvas.style.width = rect.width + 'px'
      canvas.style.height = rect.height + 'px'

      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.setTransform(dpr.current, 0, 0, dpr.current, 0, 0)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (tmp.width) ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, rect.width, rect.height)

      undoStack.current = []
      refreshUndo()
    }, [refreshUndo])

    useEffect(() => {
      const ro = new ResizeObserver(() => fitCanvas())
      if (wrapRef.current) ro.observe(wrapRef.current)
      fitCanvas()
      return () => ro.disconnect()
    }, [fitCanvas])

    useImperativeHandle(ref, () => ({
      getImageBase64() {
        const canvas = canvasRef.current
        if (!canvas) return ''

        // Flatten onto white background at native resolution
        const flat = document.createElement('canvas')
        flat.width = canvas.width; flat.height = canvas.height
        const fctx = flat.getContext('2d')!
        fctx.fillStyle = '#ffffff'
        fctx.fillRect(0, 0, flat.width, flat.height)
        fctx.drawImage(canvas, 0, 0)

        // Find bounding box of ink (non-white pixels)
        const px = fctx.getImageData(0, 0, flat.width, flat.height).data
        let x0 = flat.width, x1 = 0, y0 = flat.height, y1 = 0
        for (let y = 0; y < flat.height; y++) {
          for (let x = 0; x < flat.width; x++) {
            const i = (y * flat.width + x) * 4
            if (px[i] < 200 || px[i + 1] < 200 || px[i + 2] < 200) {
              if (x < x0) x0 = x; if (x > x1) x1 = x
              if (y < y0) y0 = y; if (y > y1) y1 = y
            }
          }
        }

        // Nothing drawn — return blank
        if (x0 > x1 || y0 > y1) return flat.toDataURL('image/png')

        // Add 20% padding around the ink
        const pw = Math.round((x1 - x0) * 0.2)
        const ph = Math.round((y1 - y0) * 0.2)
        x0 = Math.max(0, x0 - pw); x1 = Math.min(flat.width,  x1 + pw)
        y0 = Math.max(0, y0 - ph); y1 = Math.min(flat.height, y1 + ph)

        // Render cropped ink centred in a 280×280 square
        const SIZE = 280
        const out = document.createElement('canvas')
        out.width = SIZE; out.height = SIZE
        const octx = out.getContext('2d')!
        octx.fillStyle = '#ffffff'
        octx.fillRect(0, 0, SIZE, SIZE)

        const srcW = x1 - x0, srcH = y1 - y0
        const scale = Math.min((SIZE * 0.75) / srcW, (SIZE * 0.75) / srcH)
        const dstW = srcW * scale, dstH = srcH * scale
        octx.drawImage(flat, x0, y0, srcW, srcH,
          (SIZE - dstW) / 2, (SIZE - dstH) / 2, dstW, dstH)

        return out.toDataURL('image/jpeg', 0.92)
      },
      clear(doSnapshot = true) {
        const canvas = canvasRef.current
        if (!canvas) return
        if (doSnapshot && hasDrawn.current) snapshot()
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.restore()
        hasDrawn.current = false
      },
      undo() {
        if (!undoStack.current.length) return
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        const img = undoStack.current.pop()!
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalCompositeOperation = 'source-over'
        ctx.putImageData(img, 0, 0)
        ctx.restore()
        refreshUndo()
      },
    }), [snapshot, refreshUndo])

    const applyStroke = useCallback((ctx: CanvasRenderingContext2D) => {
      const sz = PEN_SIZES[sizeRef.current]
      ctx.lineWidth = sz * (toolRef.current === 'erase' ? 6 : 1)
      if (toolRef.current === 'erase') {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.strokeStyle = 'rgba(0,0,0,1)'
        ctx.fillStyle = 'rgba(0,0,0,1)'
      } else {
        ctx.globalCompositeOperation = 'source-over'
        ctx.strokeStyle = colorRef.current
        ctx.fillStyle = colorRef.current
      }
    }, [])

    const ptFrom = useCallback((e: PointerEvent): { x: number; y: number } => {
      const rect = canvasRef.current!.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }, [])

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return

      function onDown(e: PointerEvent) {
        if (e.button !== 0) return
        drawing.current = true
        canvas!.setPointerCapture(e.pointerId)
        snapshot()
        const p = ptFrom(e)
        lastPt.current = p; lastMid.current = p
        const ctx = canvas!.getContext('2d', { willReadFrequently: true })!
        applyStroke(ctx)
        ctx.beginPath()
        ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2)
        ctx.fill()
        if (!hasDrawn.current) { hasDrawn.current = true; onFirstDraw() }
      }

      function onMove(e: PointerEvent) {
        if (!drawing.current) return
        const events = (e as any).getCoalescedEvents?.() as PointerEvent[] | undefined
        const list = events?.length ? events : [e]
        const ctx = canvas!.getContext('2d', { willReadFrequently: true })!
        applyStroke(ctx)
        for (const ev of list) {
          const p = ptFrom(ev)
          const mid = { x: (lastPt.current!.x + p.x) / 2, y: (lastPt.current!.y + p.y) / 2 }
          ctx.beginPath()
          ctx.moveTo(lastMid.current!.x, lastMid.current!.y)
          ctx.quadraticCurveTo(lastPt.current!.x, lastPt.current!.y, mid.x, mid.y)
          ctx.stroke()
          lastPt.current = p; lastMid.current = mid
        }
      }

      function onUp(e: PointerEvent) {
        if (!drawing.current) return
        drawing.current = false
        try { canvas!.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      }

      canvas.addEventListener('pointerdown', onDown)
      canvas.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      canvas.addEventListener('pointerleave', onUp)
      return () => {
        canvas.removeEventListener('pointerdown', onDown)
        canvas.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        canvas.removeEventListener('pointerleave', onUp)
      }
    }, [applyStroke, ptFrom, snapshot, onFirstDraw])

    // keyboard shortcuts
    useEffect(() => {
      function onKey(e: KeyboardEvent) {
        if ((e.target as HTMLElement).tagName === 'INPUT') return
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault()
          if (undoStack.current.length) {
            const canvas = canvasRef.current!
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!
            const img = undoStack.current.pop()!
            ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.globalCompositeOperation='source-over'
            ctx.putImageData(img, 0, 0); ctx.restore()
            refreshUndo()
          }
        }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [refreshUndo])

    const eraserVisSize = PEN_SIZES[penSize] * 6
    const dotSize = tool === 'erase' ? eraserVisSize * 2 : 12

    return (
      <div
        ref={wrapRef}
        style={{ position: 'absolute', inset: 0, cursor: 'none' }}
        onPointerMove={e => setCursor({ x: e.clientX - wrapRef.current!.getBoundingClientRect().left, y: e.clientY - wrapRef.current!.getBoundingClientRect().top })}
        onPointerLeave={() => setCursor(null)}
      >
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, touchAction: 'none', display: 'block' }} />

        {cursor && (
          <div style={{
            position: 'absolute',
            left: cursor.x, top: cursor.y,
            width: dotSize, height: dotSize,
            transform: 'translate(-50%,-50%)',
            borderRadius: '50%',
            border: tool === 'erase' ? `2px solid ${penColor === '#2E2820' ? '#2E2820' : penColor}` : 'none',
            background: tool === 'erase' ? 'rgba(255,255,255,0.5)' : penColor,
            pointerEvents: 'none',
            zIndex: 10,
            boxShadow: '0 0 0 1.5px rgba(255,255,255,0.9)',
            opacity: 0.85,
          }} />
        )}
      </div>
    )
  }
)

DrawingCanvas.displayName = 'DrawingCanvas'
export default DrawingCanvas

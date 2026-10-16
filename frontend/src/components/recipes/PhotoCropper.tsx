import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Dialog } from '../ui/Dialog'
import { PHOTO_MAX_BYTES, PHOTO_MAX_SIDE, loadImage } from '../../recipes'

const ASPECTS = [
  { id: '4:3', label: 'Card (4:3)', value: 4 / 3 },
  { id: '1:1', label: 'Square', value: 1 },
  { id: '16:9', label: 'Wide (16:9)', value: 16 / 9 },
]
const MAX_ZOOM = 4

interface View {
  scale: number
  x: number // image's top-left inside the frame, in frame px (<= 0)
  y: number
}

// A photo over the size limits has to be cropped before it can be used. The picture sits
// under a fixed frame: drag to move it, zoom with the slider (or +/−, mouse wheel, pinch
// via the slider), pick a shape. What is inside the frame is the result, scaled to fit the
// limits — so there is no way to use the original.
export function PhotoCropper({
  file,
  reason,
  onCancel,
  onCropped,
}: {
  file: File
  reason: string
  onCancel: () => void
  onCropped: (photo: Blob) => void
}) {
  const [loaded, setLoaded] = useState<{ image: HTMLImageElement; url: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const [aspectId, setAspectId] = useState('4:3')
  const [frameW, setFrameW] = useState(320)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const [saving, setSaving] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null)

  const aspect = ASPECTS.find((a) => a.id === aspectId)!.value
  const frameH = Math.round(frameW / aspect)
  const natural = loaded ? { w: loaded.image.naturalWidth, h: loaded.image.naturalHeight } : null
  // The smallest scale that still covers the frame.
  const minScale = natural ? Math.max(frameW / natural.w, frameH / natural.h) : 1

  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    loadImage(file)
      .then((result) => {
        if (cancelled) return URL.revokeObjectURL(result.url)
        url = result.url
        setLoaded(result)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setFrameW(Math.max(220, Math.min(Math.round(el.getBoundingClientRect().width), 520)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const clamp = (v: View): View => {
    if (!natural) return v
    const scale = Math.min(Math.max(v.scale, minScale), minScale * MAX_ZOOM)
    return {
      scale,
      x: Math.min(0, Math.max(frameW - natural.w * scale, v.x)),
      y: Math.min(0, Math.max(frameH - natural.h * scale, v.y)),
    }
  }

  // Start centred and covering whenever the image, shape or frame size changes.
  useEffect(() => {
    if (!natural) return
    setView({ scale: minScale, x: (frameW - natural.w * minScale) / 2, y: (frameH - natural.h * minScale) / 2 })
  }, [natural?.w, natural?.h, aspectId, frameW]) // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom about the frame's centre so what you're looking at stays put.
  const zoomTo = (scale: number) =>
    setView((v) => {
      const next = Math.min(Math.max(scale, minScale), minScale * MAX_ZOOM)
      const cx = (frameW / 2 - v.x) / v.scale
      const cy = (frameH / 2 - v.y) / v.scale
      return clamp({ scale: next, x: frameW / 2 - cx * next, y: frameH / 2 - cy * next })
    })

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (d) setView((v) => clamp({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 16
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    if (moves[e.key]) {
      e.preventDefault()
      setView((v) => clamp({ ...v, x: v.x + moves[e.key][0], y: v.y + moves[e.key][1] }))
    } else if (e.key === '+' || e.key === '=') zoomTo(view.scale * 1.15)
    else if (e.key === '-') zoomTo(view.scale / 1.15)
  }

  // What the frame shows, drawn at the largest size the limits allow, JPEG-compressed until it fits.
  const save = async () => {
    if (!loaded || !natural) return
    setSaving(true)
    try {
      const sw = frameW / view.scale
      const sh = frameH / view.scale
      const shrink = Math.min(1, PHOTO_MAX_SIDE / Math.max(sw, sh))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(sw * shrink))
      canvas.height = Math.max(1, Math.round(sh * shrink))
      canvas.getContext('2d')!.drawImage(loaded.image, -view.x / view.scale, -view.y / view.scale, sw, sh, 0, 0, canvas.width, canvas.height)
      let quality = 0.9
      let blob: Blob | null = null
      while (quality > 0.3) {
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
        if (blob && blob.size <= PHOTO_MAX_BYTES) break
        quality -= 0.15
      }
      if (!blob || blob.size > PHOTO_MAX_BYTES) throw new Error('could not shrink')
      onCropped(blob)
    } catch {
      setFailed(true)
      setSaving(false)
    }
  }

  const sliderMax = useMemo(() => minScale * MAX_ZOOM, [minScale])

  return (
    <Dialog title="Crop photo" onClose={onCancel}>
      <p className="m-0 text-sm text-text/80">
        {reason} Move and zoom the picture so the part you want is inside the frame, then crop.
      </p>

      <div ref={boxRef} className="grid justify-items-center gap-3">
        {failed ? (
          <p className="m-0 rounded-[14px] bg-danger-bg px-4 py-6 text-center text-sm text-danger">
            That image couldn't be opened here. Try a JPEG or PNG.
          </p>
        ) : (
          <div
            role="group"
            tabIndex={0}
            aria-label="Crop frame. Drag to move the photo, plus and minus to zoom, arrow keys to nudge."
            className="relative touch-none overflow-hidden rounded-[14px] bg-chip outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
            style={{ width: frameW, height: frameH, cursor: drag.current ? 'grabbing' : 'grab' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onWheel={(e) => zoomTo(view.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
            onKeyDown={onKeyDown}
          >
            {loaded && natural && (
              <img
                src={loaded.url}
                alt=""
                draggable={false}
                className="pointer-events-none absolute top-0 left-0 max-w-none select-none"
                style={{ width: natural.w * view.scale, height: natural.h * view.scale, transform: `translate(${view.x}px, ${view.y}px)` }}
              />
            )}
            {/* rule-of-thirds guides */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 border border-white/70" style={{ boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.25)' }}>
              <div className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
              <div className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
            </div>
            {!loaded && <div className="skel absolute inset-0" />}
          </div>
        )}

        <div className="flex w-full items-center gap-3" style={{ maxWidth: frameW }}>
          <button type="button" className="btn btn-secondary btn-icon" aria-label="Zoom out" disabled={!loaded} onClick={() => zoomTo(view.scale / 1.15)}>
            −
          </button>
          <input
            type="range"
            aria-label="Zoom"
            className="min-w-0 flex-1 accent-accent"
            min={minScale}
            max={sliderMax}
            step={(sliderMax - minScale) / 100 || 0.01}
            value={view.scale}
            disabled={!loaded}
            onChange={(e) => zoomTo(Number(e.target.value))}
          />
          <button type="button" className="btn btn-secondary btn-icon" aria-label="Zoom in" disabled={!loaded} onClick={() => zoomTo(view.scale * 1.15)}>
            +
          </button>
        </div>

        <div className="seg max-w-full flex-wrap" role="radiogroup" aria-label="Crop shape">
          {ASPECTS.map((a) => (
            <label key={a.id} className="seg-opt min-h-11">
              <input type="radio" name="crop-aspect" checked={aspectId === a.id} onChange={() => setAspectId(a.id)} />
              {a.label}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!loaded || saving || failed} onClick={save}>
          {saving ? 'Cropping…' : 'Crop and use photo'}
        </button>
      </div>
    </Dialog>
  )
}

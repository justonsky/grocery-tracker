import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

export interface PricePoint {
  date: string // ISO yyyy-MM-dd
  price: number
  storeName: string
  profileName: string
}

const money = (n: number) => `$${n.toFixed(2)}`
const DAY = 86_400_000
const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })

const MARGIN = { top: 14, right: 18, bottom: 30, left: 56 }

// Stores take the chart series colours in order of first appearance; a fifth
// store onwards shares the last colour. The line itself always stays chart-1.
const STORE_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']
const HEIGHT = 260

// Clean y ticks: a 1/2/2.5/5 × 10^k step giving about four intervals.
function niceTicks(min: number, max: number): number[] {
  if (min === max) {
    const pad = Math.max(0.5, Math.abs(max) * 0.1)
    min -= pad
    max += pad
  }
  const rough = (max - min) / 4
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude
  const start = Math.max(0, Math.floor(min / step) * step)
  const ticks: number[] = []
  for (let v = start; v <= max + step * 0.5 && ticks.length < 12; v += step) ticks.push(Math.round(v * 100) / 100)
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 100) / 100)
  return ticks
}

// Calendar-aligned x ticks (days, months or years) for the time span, about one
// per `minGap` pixels.
function timeTicks(start: number, end: number, width: number): { t: number; label: string }[] {
  const span = end - start
  const maxTicks = Math.max(2, Math.floor(width / 84))
  const out: { t: number; label: string }[] = []

  if (span <= 75 * DAY) {
    const stepDays = [1, 2, 7, 14, 28].find((d) => span / (d * DAY) <= maxTicks) ?? 28
    const first = new Date(start)
    for (let t = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()); t <= end; t += stepDays * DAY) {
      if (t >= start) {
        const d = new Date(t)
        out.push({ t, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` })
      }
    }
    return out
  }

  const months = span / (30.44 * DAY)
  if (months <= 48) {
    const stepMonths = [1, 2, 3, 4, 6, 12].find((m) => months / m <= maxTicks) ?? 12
    const first = new Date(start)
    let y = first.getUTCFullYear()
    let m = first.getUTCMonth() + 1 // first month boundary after the start
    m = Math.ceil(m / stepMonths) * stepMonths
    for (;;) {
      y += Math.floor(m / 12)
      m %= 12
      const t = Date.UTC(y, m, 1)
      if (t > end) break
      // Sparse ticks (a quarter or more apart) each carry the year; dense ones only at January and the start.
      out.push({ t, label: stepMonths >= 3 || m === 0 || out.length === 0 ? `${MONTHS[m]} '${String(y).slice(2)}` : MONTHS[m] })
      m += stepMonths
    }
    return out
  }

  const years = span / (365.25 * DAY)
  const stepYears = [1, 2, 5, 10].find((s) => years / s <= maxTicks) ?? 10
  for (let y = new Date(start).getUTCFullYear() + 1; ; y += stepYears) {
    const t = Date.UTC(y, 0, 1)
    if (t > end) break
    out.push({ t, label: String(y) })
  }
  return out
}

// Price over time for one item: dates on a true time scale (gaps between
// purchases show as gaps), clean currency ticks, and a crosshair that snaps to
// the nearest purchase. Arrow keys step through purchases when focused. The
// purchase table beside it carries every value without hovering.
export function PriceChart({ points }: { points: PricePoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const storeColors = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of points) {
      if (!map.has(p.storeName)) map.set(p.storeName, STORE_COLORS[Math.min(map.size, STORE_COLORS.length - 1)])
    }
    return map
  }, [points])
  const colorOf = (p: PricePoint) => storeColors.get(p.storeName) ?? STORE_COLORS[0]

  const geometry = useMemo(() => {
    if (points.length === 0) return null
    const times = points.map((p) => toTime(p.date))
    let start = Math.min(...times)
    let end = Math.max(...times)
    if (start === end) {
      start -= 3 * DAY
      end += 3 * DAY
    }
    const yTicks = niceTicks(Math.min(...points.map((p) => p.price)), Math.max(...points.map((p) => p.price)))
    const yMin = yTicks[0]
    const yMax = yTicks[yTicks.length - 1]
    const plotW = width - MARGIN.left - MARGIN.right
    const plotH = HEIGHT - MARGIN.top - MARGIN.bottom
    const x = (t: number) => MARGIN.left + ((t - start) / (end - start)) * plotW
    const y = (v: number) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH
    const coords = points.map((p, i) => ({ x: x(times[i]), y: y(p.price) }))
    return { coords, yTicks, y, xTicks: timeTicks(start, end, plotW).map((tick) => ({ ...tick, x: x(tick.t) })), plotW, plotH }
  }, [points, width])

  if (!geometry) {
    return (
      <div className="grid h-[260px] place-items-center text-sm text-text/60">No purchases in this range.</div>
    )
  }

  const { coords, yTicks, y, xTicks } = geometry
  const baseline = HEIGHT - MARGIN.bottom
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ')
  const area = coords.length > 1 ? `${line} L${coords[coords.length - 1].x},${baseline} L${coords[0].x},${baseline} Z` : ''
  // Dots carry the store colours the legend explains, so keep them for long histories too (smaller).
  const showAllMarkers = coords.length <= 160
  const dotRadius = coords.length > 40 ? 3 : 4.5

  const nearest = (clientX: number) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    const px = clientX - rect.left
    let best = 0
    for (let i = 1; i < coords.length; i++) {
      if (Math.abs(coords[i].x - px) < Math.abs(coords[best].x - px)) best = i
    }
    return best
  }
  const onPointerMove = (e: PointerEvent) => setActive(nearest(e.clientX))
  const onKeyDown = (e: KeyboardEvent) => {
    const last = coords.length - 1
    const current = active ?? last
    const next =
      e.key === 'ArrowLeft' ? Math.max(0, current - 1)
      : e.key === 'ArrowRight' ? Math.min(last, current + 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null
    if (next !== null) {
      e.preventDefault()
      setActive(next)
    } else if (e.key === 'Escape') {
      setActive(null)
    }
  }

  const activePoint = active !== null ? points[active] : null
  const activeCoord = active !== null ? coords[active] : null
  const first = points[0]
  const last = points[points.length - 1]

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0" aria-label="Stores">
          {[...storeColors].map(([name, color]) => (
            <li key={name} className="inline-flex items-center gap-1.5 text-[13px] text-text/80">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
              {name}
            </li>
          ))}
        </ul>
        <span className="text-[13px] text-text/70">
          {points.length} {points.length === 1 ? 'purchase' : 'purchases'} · household-wide
        </span>
      </div>
      <div
        ref={wrapRef}
        className="relative touch-pan-y outline-none focus-visible:rounded-md focus-visible:shadow-[0_0_0_2px_var(--color-accent)]"
        tabIndex={0}
        role="img"
        aria-label={`Price over time: ${points.length} ${points.length === 1 ? 'purchase' : 'purchases'} from ${longDate(first.date)} (${money(first.price)}) to ${longDate(last.date)} (${money(last.price)}). Use the left and right arrow keys to step through them.`}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
        onKeyDown={onKeyDown}
        onFocus={() => active === null && setActive(coords.length - 1)}
        onBlur={() => setActive(null)}
      >
        <svg width={width} height={HEIGHT} className="block overflow-visible" aria-hidden="true">
          {/* Gridlines + y axis labels */}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(v)} y2={y(v)} stroke="var(--color-divider)" strokeWidth={1} />
              <text x={MARGIN.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={12} fill="currentColor" className="text-text/70 tabular-nums">
                {money(v)}
              </text>
            </g>
          ))}
          {/* x axis line, ticks and labels */}
          <line x1={MARGIN.left} x2={width - MARGIN.right} y1={baseline} y2={baseline} stroke="var(--color-control)" strokeWidth={1} />
          {xTicks.map((tick) => (
            <g key={tick.t}>
              <line x1={tick.x} x2={tick.x} y1={baseline} y2={baseline + 4} stroke="var(--color-control)" strokeWidth={1} />
              <text x={tick.x} y={baseline + 17} textAnchor="middle" fontSize={12} fill="currentColor" className="text-text/70 tabular-nums">
                {tick.label}
              </text>
            </g>
          ))}

          {area && <path d={area} fill="var(--chart-1)" fillOpacity={0.13} />}
          {coords.length > 1 && <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth={2.5} strokeLinejoin="round" />}
          {(showAllMarkers || coords.length === 1 ? coords : []).map((c, i) => (
            <circle key={i} cx={c.x} cy={c.y} r={dotRadius} fill={colorOf(points[i])} stroke="var(--color-surface)" strokeWidth={coords.length > 40 ? 1.5 : 2} />
          ))}

          {activeCoord && (
            <g>
              <line x1={activeCoord.x} x2={activeCoord.x} y1={MARGIN.top} y2={baseline} stroke="var(--color-text)" strokeOpacity={0.35} strokeWidth={1} />
              <circle cx={activeCoord.x} cy={activeCoord.y} r={7} fill={colorOf(points[active!])} stroke="var(--color-surface)" strokeWidth={3} />
            </g>
          )}
        </svg>

        {activePoint && activeCoord && (
          <div
            className="pointer-events-none absolute z-10 min-w-[150px] rounded-md bg-text px-3 py-2.5 text-xs whitespace-nowrap text-bg"
            style={{
              boxShadow: 'var(--shadow-lg)',
              top: Math.max(0, activeCoord.y - 86),
              // Flip to the left of the crosshair near the right edge.
              ...(activeCoord.x > width - 180 ? { right: width - activeCoord.x + 14 } : { left: activeCoord.x + 14 }),
            }}
          >
            <div className="font-heading text-xl leading-tight font-bold tabular-nums">{money(activePoint.price)}</div>
            <div className="opacity-85">{longDate(activePoint.date)}</div>
            <div className="flex items-center gap-1.5 opacity-85">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(activePoint) }} />
              {activePoint.storeName} · {activePoint.profileName}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

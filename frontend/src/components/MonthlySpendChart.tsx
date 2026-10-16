import { useEffect, useRef, useState } from 'react'
import type { MonthlySpend } from '../api/types'

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthName = (ym: string) => SHORT_MONTHS[Number(ym.slice(5, 7)) - 1]
const monthLong = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })

const HEIGHT = 220
const DEFAULT_WIDTH = 640
const MARGIN = { top: 12, right: 8, bottom: 26, left: 52 }

// The chart is drawn at its real pixel width so axis text stays a readable size on a phone.
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.max(Math.round(el.getBoundingClientRect().width), 280))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

// A 1/2/2.5/5 × 10^k step giving about four intervals, so the axis reads in round numbers.
function niceMax(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 }
  const raw = max / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
  return { top: Math.ceil(max / step) * step, step }
}

// Spend per calendar month. The latest month (the one in progress) is chart-1,
// earlier months a softer tint of it, so "this month" reads first.
export function MonthlySpendChart({ months }: { months: MonthlySpend[] }) {
  const [active, setActive] = useState<number | null>(null)
  const [boxRef, WIDTH] = useWidth<HTMLDivElement>()
  const narrow = WIDTH < 480
  const total = months.reduce((sum, m) => sum + m.total, 0)

  const { top, step } = niceMax(Math.max(...months.map((m) => m.total), 0))
  const margin = narrow ? { ...MARGIN, left: 44 } : MARGIN
  const plotW = WIDTH - margin.left - margin.right
  const plotH = HEIGHT - margin.top - margin.bottom
  const slot = plotW / Math.max(months.length, 1)
  const barW = Math.min(34, slot * 0.64)
  const y = (v: number) => margin.top + plotH - (v / top) * plotH
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const shown = active != null ? months[active] : null

  return (
    <div ref={boxRef} className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px] text-text/70">
        <span aria-live="polite">
          {shown
            ? `${monthLong(shown.month)} · ${money(shown.total)} · ${shown.count} ${shown.count === 1 ? 'trip' : 'trips'}`
            : `Last ${months.length} months · ${money(total)}`}
        </span>
        <span>Tap or hover a bar for details</span>
      </div>
      <svg
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={`Monthly spending, last ${months.length} months: ${months.map((m) => `${monthLong(m.month)} ${money(m.total)}`).join(', ')}`}
        className="block max-w-full"
        onPointerLeave={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={margin.left} x2={WIDTH - margin.right} y1={y(t)} y2={y(t)} stroke="var(--color-divider)" strokeWidth="1" />
            <text x={margin.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-text)" opacity="0.6" className="tabular-nums">
              ${t.toLocaleString()}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = margin.left + slot * i + slot / 2
          const latest = i === months.length - 1
          const h = Math.max(plotH - (y(m.total) - margin.top), m.total > 0 ? 2 : 0)
          return (
            <g key={m.month} onPointerEnter={() => setActive(i)} onPointerDown={() => setActive(i)}>
              {/* A full-height hit area, so empty months and short bars are still easy to touch. */}
              <rect x={cx - slot / 2} y={margin.top} width={slot} height={plotH + margin.bottom} fill="transparent" />
              <rect
                x={cx - barW / 2}
                y={margin.top + plotH - h}
                width={barW}
                height={h}
                rx="4"
                fill="var(--chart-1)"
                opacity={active === i || (active == null && latest) ? 1 : 0.55}
              />
              <text
                x={cx}
                y={HEIGHT - 8}
                textAnchor="middle"
                fontSize="11"
                fill="var(--color-text)"
                opacity={latest || active === i ? 0.9 : 0.6}
                fontWeight={latest ? 700 : 400}
              >
                {monthName(m.month)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

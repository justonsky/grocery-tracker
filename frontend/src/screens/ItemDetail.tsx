import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { PriceChart } from '../components/PriceChart'

const money = (n: number) => `$${n.toFixed(2)}`
// "+$0.89" / "-$0.89" (not "$-0.89").
const signedMoney = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${money(Math.abs(n))}`
const ROWS_PER_PAGE = 15

function Stat({
  label,
  value,
  note,
  highlight,
  className = '',
}: {
  label: string
  value: string
  note: string
  highlight?: boolean
  className?: string
}) {
  return (
    <div
      className={`card gap-1.5 px-[18px] py-4 sm:px-5 sm:py-[18px] ${highlight ? 'bg-highlight-bg text-highlight-ink' : 'elev-sm'} ${className}`}
    >
      <div className={`card-kicker ${highlight ? 'text-highlight-ink' : 'text-text/60'}`}>{label}</div>
      <div className="font-heading text-[28px] leading-none font-bold tracking-tight tabular-nums sm:text-[30px]">{value}</div>
      <div className={`card-meta text-[13px] ${highlight ? 'text-highlight-ink' : ''}`}>{note}</div>
    </div>
  )
}
const isoDaysAgo = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toLocaleDateString('en-CA') // yyyy-MM-dd in local time
}

type Preset = 'all' | '30d' | '90d' | '6m' | '1y' | 'custom'
const PRESETS: { id: Preset; label: string; days?: number }[] = [
  { id: 'all', label: 'All time' },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: '6m', label: '6 months', days: 182 },
  { id: '1y', label: '1 year', days: 365 },
  { id: 'custom', label: 'Custom' },
]

// Household-wide: every profile's purchases of this item. The date range scopes
// everything below it — chart, statistics and table — so the numbers always agree.
export function ItemDetail() {
  const { itemId } = useParams()
  const navigate = useNavigate()
  const [preset, setPreset] = useState<Preset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [rowsShown, setRowsShown] = useState(ROWS_PER_PAGE)

  const days = PRESETS.find((p) => p.id === preset)?.days
  const range =
    preset === 'custom'
      ? { from: customFrom || null, to: customTo || null }
      : { from: days ? isoDaysAgo(days) : null, to: null }

  const { data: history, isLoading, isFetching, isError } = useQuery({
    queryKey: ['item-history', itemId, range.from, range.to],
    queryFn: () => api.items.history(itemId!, range),
    // Changing the range keeps the previous render (dimmed) instead of flashing a skeleton.
    placeholderData: keepPreviousData,
  })

  if (isError && !history) {
    return (
      <div className="mx-auto max-w-[1000px] px-4 pt-6 pb-15 sm:px-6">
        <div className="card elev-sm gap-2 text-sm">
          <p className="m-0">This item couldn't be loaded — it may have been merged into another item or deleted.</p>
          <Link to="/items" className="btn btn-secondary self-start">
            Go to Items
          </Link>
        </div>
      </div>
    )
  }

  if (isLoading || !history) {
    return (
      <div className="mx-auto max-w-[1000px] px-4 pt-6 pb-15 sm:px-6">
        <div className="skel h-8 w-40" />
      </div>
    )
  }

  const chartPoints = [...history.history].reverse()
  const empty = history.purchaseCount === 0

  return (
    <div className="mx-auto max-w-[1000px] px-4 pt-6 pb-15 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" className="btn btn-secondary btn-icon shrink-0" aria-label="Back" onClick={() => navigate(-1)}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="m-0 min-w-0 text-2xl leading-tight break-words sm:text-[32px]">{history.itemName}</h1>
          <span className="tag tag-neutral">{history.categoryName}</span>
        </div>
        <Link to={`/items?item=${history.itemId}`} className="btn btn-secondary shrink-0">
          Edit records
        </Link>
      </div>

      {/* Filters: one row above everything they scope. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="seg max-w-full flex-wrap" role="radiogroup" aria-label="Date range">
          {PRESETS.map((p) => (
            <label key={p.id} className="seg-opt min-h-11 sm:min-h-10">
              <input
                type="radio"
                name="range"
                checked={preset === p.id}
                onChange={() => {
                  setPreset(p.id)
                  setRowsShown(ROWS_PER_PAGE)
                }}
              />
              {p.label}
            </label>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <input
              className="input w-auto"
              type="date"
              aria-label="From date"
              value={customFrom}
              min={history.firstDate ?? undefined}
              max={customTo || history.lastDate || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span className="text-text/60">to</span>
            <input
              className="input w-auto"
              type="date"
              aria-label="To date"
              value={customTo}
              min={customFrom || history.firstDate || undefined}
              max={history.lastDate ?? undefined}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className={`transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
        <div className="card elev-sm gap-0 p-4 pb-3 sm:p-5 sm:pb-3">
          <PriceChart points={chartPoints} />
        </div>

        {!empty && (
          <div className="my-4 grid grid-cols-2 gap-3 sm:my-5 sm:gap-3.5 lg:grid-cols-5">
            <Stat
              label="Latest"
              value={money(history.current)}
              note={[history.history[0]?.date, history.history[0]?.storeName].filter(Boolean).join(' · ')}
            />
            <Stat label="Lowest" value={money(history.lowest)} note={history.lowestMeta} highlight />
            <Stat label="Highest" value={money(history.highest)} note={history.highestMeta} />
            <Stat
              label="Average"
              value={money(history.average)}
              note={`${history.purchaseCount} ${history.purchaseCount === 1 ? 'purchase' : 'purchases'}`}
            />
            <Stat
              label="Variation"
              value={`±${money(history.variance)}`}
              note={`±${history.variancePct.toFixed(1)}% of average`}
              className="col-span-2 lg:col-span-1"
            />
          </div>
        )}

        <h2 className={`mb-3 text-xl ${empty ? 'mt-5' : ''}`}>Purchase history</h2>
        {empty ? (
          <p className="text-sm text-text/70">
            No purchases in this range
            {history.firstDate && ` — this item was bought between ${history.firstDate} and ${history.lastDate}`}.
          </p>
        ) : (
          <div className="card elev-sm overflow-x-auto p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Store</th>
                  <th>Who</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {history.history.slice(0, rowsShown).map((h) => (
                  <tr key={h.lineId}>
                    <td className="whitespace-nowrap">{h.date}</td>
                    <td>{h.storeName}</td>
                    <td>{h.profileName}</td>
                    <td className="text-right font-semibold">{money(h.price)}</td>
                    <td
                      className={`text-right whitespace-nowrap ${
                        h.deltaFromPrevious == null || h.deltaFromPrevious === 0
                          ? 'text-text/70'
                          : h.deltaFromPrevious > 0
                            ? 'font-semibold text-danger'
                            : 'font-semibold text-accent'
                      }`}
                    >
                      {h.deltaFromPrevious == null ? '—' : signedMoney(h.deltaFromPrevious)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {history.history.length > rowsShown && (
              <button
                type="button"
                className="btn btn-secondary m-3 self-center"
                onClick={() => setRowsShown((n) => n + ROWS_PER_PAGE)}
              >
                Show {Math.min(ROWS_PER_PAGE, history.history.length - rowsShown)} more of {history.history.length - rowsShown}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

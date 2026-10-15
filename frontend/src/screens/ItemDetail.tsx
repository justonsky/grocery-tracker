import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { PriceChart } from '../components/PriceChart'

const money = (n: number) => `$${n.toFixed(2)}`
// "+$0.89" / "-$0.89" (not "$-0.89").
const signedMoney = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${money(Math.abs(n))}`
const ROWS_PER_PAGE = 15
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

  const { data: history, isLoading, isFetching } = useQuery({
    queryKey: ['item-history', itemId, range.from, range.to],
    queryFn: () => api.items.history(itemId!, range),
    // Changing the range keeps the previous render (dimmed) instead of flashing a skeleton.
    placeholderData: keepPreviousData,
  })

  if (isLoading || !history) {
    return (
      <div className="mx-auto max-w-[860px] px-5 pt-6 pb-15">
        <div className="skel h-8 w-40" />
      </div>
    )
  }

  const chartPoints = [...history.history].reverse()
  const empty = history.purchaseCount === 0

  return (
    <div className="mx-auto max-w-[860px] px-5 pt-6 pb-15">
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Back" onClick={() => navigate(-1)}>
          ←
        </button>
        <h3 className="m-0">{history.itemName}</h3>
        <span className="tag tag-outline">{history.categoryName}</span>
        <Link to={`/items?item=${history.itemId}`} className="btn btn-ghost ml-auto">
          Edit records
        </Link>
      </div>

      {/* Filters: one row above everything they scope. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="seg flex-wrap" role="radiogroup" aria-label="Date range">
          {PRESETS.map((p) => (
            <label key={p.id} className="seg-opt">
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
        <div className="card elev-sm">
          <PriceChart points={chartPoints} />
        </div>

        {!empty && (
          <div className="my-4.5 grid grid-cols-2 gap-3.5 lg:grid-cols-5">
            <div className="card elev-sm">
              <div className="card-kicker">Latest</div>
              <div className="card-title">{money(history.current)}</div>
              <div className="card-meta">{history.history[0]?.date}</div>
            </div>
            <div className="card elev-sm">
              <div className="card-kicker">Lowest</div>
              <div className="card-title">{money(history.lowest)}</div>
              <div className="card-meta">{history.lowestMeta}</div>
            </div>
            <div className="card elev-sm">
              <div className="card-kicker">Highest</div>
              <div className="card-title">{money(history.highest)}</div>
              <div className="card-meta">{history.highestMeta}</div>
            </div>
            <div className="card elev-sm">
              <div className="card-kicker">Average</div>
              <div className="card-title">{money(history.average)}</div>
              <div className="card-meta">
                {history.purchaseCount} {history.purchaseCount === 1 ? 'purchase' : 'purchases'}
              </div>
            </div>
            <div className="card elev-sm col-span-2 lg:col-span-1">
              <div className="card-kicker">Variation</div>
              <div className="card-title">±{money(history.variance)}</div>
              <div className="card-meta">±{history.variancePct.toFixed(1)}% of average</div>
            </div>
          </div>
        )}

        <h4 className={`mb-2 ${empty ? 'mt-4.5' : ''}`}>Purchase history</h4>
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
                    <td className="text-right">{money(h.price)}</td>
                    <td
                      className="text-right whitespace-nowrap"
                      style={{
                        color:
                          h.deltaFromPrevious == null || h.deltaFromPrevious === 0
                            ? undefined
                            : h.deltaFromPrevious > 0
                              ? 'var(--color-danger)'
                              : 'var(--color-accent)',
                      }}
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
                className="btn btn-ghost m-2 self-center"
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

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { TrackedItem } from '../api/types'

const money = (n: number) => `$${n.toFixed(2)}`

function Sparkline({ prices }: { prices: number[] }) {
  if (prices.length < 2) return <svg width="100%" height="30" viewBox="0 0 100 30" />
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const step = 100 / (prices.length - 1)
  const points = prices.map((p, i) => `${i * step},${28 - ((p - min) / range) * 26}`)
  return (
    <svg width="100%" height="30" viewBox="0 0 100 30" preserveAspectRatio="none" className="block">
      <path d={`M${points.join(' L')}`} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
    </svg>
  )
}

const TREND_TAG: Record<TrackedItem['trend'], string> = {
  up: 'tag-outline',
  down: 'tag-accent',
  flat: 'tag-neutral',
}
const TREND_LABEL = (item: TrackedItem) => {
  if (item.deltaFromPrevious == null) return '—'
  const sign = item.deltaFromPrevious > 0 ? '+' : item.deltaFromPrevious < 0 ? '-' : ''
  return `${sign}${money(Math.abs(item.deltaFromPrevious)).slice(1)}`
}

export function Dashboard({ profileId }: { profileId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', profileId],
    queryFn: () => api.dashboard(profileId),
  })

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-[1000px] px-5 py-6">
        <div className="skel h-20" />
      </div>
    )
  }

  return (
    <div className="mx-auto grid max-w-[1000px] gap-7 px-5 py-6 pb-15">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <div className="card elev-sm">
          <div className="card-kicker">Today</div>
          <div className="card-title">{money(data.todaySpend)}</div>
          <div className="card-meta">
            {data.todayCount} {data.todayCount === 1 ? 'trip' : 'trips'}
          </div>
        </div>
        <div className="card elev-sm">
          <div className="card-kicker">This month</div>
          <div className="card-title">{money(data.monthSpend)}</div>
          <div className="card-meta">
            {data.monthCount} {data.monthCount === 1 ? 'trip' : 'trips'}
          </div>
        </div>
        <div className="card elev-sm">
          <div className="card-kicker">This year</div>
          <div className="card-title">{money(data.yearSpend)}</div>
          <div className="card-meta">
            {data.yearCount} {data.yearCount === 1 ? 'trip' : 'trips'}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="m-0">Most recent trip</h3>
          <div className="flex gap-2">
            <Link to="/lists/new" className="btn btn-secondary">
              New list
            </Link>
            <Link to="/trips/new" className="btn btn-primary">
              + Log a trip
            </Link>
          </div>
        </div>
        {data.recentTrip ? (
          <div className="card elev-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="card-kicker">{data.recentTrip.date}</div>
                <div className="card-title">{data.recentTrip.storeName}</div>
              </div>
              <div className="text-right">
                <div className="font-heading text-xl">{money(data.recentTrip.total)}</div>
                <div className="text-xs text-text/70">
                  {data.recentTrip.itemCount} {data.recentTrip.itemCount === 1 ? 'item' : 'items'}
                </div>
              </div>
            </div>
            <table className="table mt-1.5">
              <tbody>
                {data.recentTrip.items.map((it, i) => (
                  <tr key={i}>
                    <td>{it.itemName}</td>
                    <td>
                      <span className="tag tag-outline">{it.categoryName}</span>
                    </td>
                    <td className="text-right">{money(it.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-1.5 flex gap-2">
              <Link to={`/trips/${data.recentTrip.id}`} className="btn btn-secondary">
                Edit trip
              </Link>
            </div>
          </div>
        ) : (
          <div className="card elev-sm items-center gap-2.5 px-8 py-8 text-center">
            <p className="m-0 mb-2.5 text-text/70">No trips logged yet.</p>
            <Link to="/trips/new" className="btn btn-primary">
              Log your first trip
            </Link>
          </div>
        )}
      </div>

      {data.trackedItems.length > 0 && (
        <div>
          <h3 className="m-0 mb-3">Items you're tracking</h3>
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            {data.trackedItems.map((item) => (
              <Link
                to={`/items/${item.itemId}`}
                key={item.itemId}
                className="card elev-sm cursor-pointer no-underline transition-transform hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div className="card-title text-[15px]">{item.itemName}</div>
                  <span className={`tag ${TREND_TAG[item.trend]}`}>{TREND_LABEL(item)}</span>
                </div>
                <Sparkline prices={item.recentPrices} />
                <div className="card-meta justify-between">
                  <span>{item.categoryName}</span>
                  <span>{money(item.lastPrice)}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

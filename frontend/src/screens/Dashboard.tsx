import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { TrackedItemsGrid } from '../components/TrackedItemsGrid'
import { useOutstandingEntityIds } from '../offline/useOutstandingIds'

const money = (n: number) => `$${n.toFixed(2)}`

export function Dashboard({ profileId }: { profileId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', profileId],
    queryFn: () => api.dashboard(profileId),
  })

  const pendingTripIds = useOutstandingEntityIds('trip')

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
          <Link to="/trips/new" className="btn btn-primary">
            + New list
          </Link>
        </div>
        {data.recentTrip ? (
          <div className="card elev-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="card-kicker">{data.recentTrip.date}</div>
                <div className="card-title flex items-center gap-1.5">
                  {data.recentTrip.name || data.recentTrip.storeName}
                  {pendingTripIds.has(data.recentTrip.id) && <span className="tag tag-neutral text-[10px]">Pending sync</span>}
                </div>
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
                    <td className="text-right">{it.price != null ? money(it.price) : <span className="text-text/40">—</span>}</td>
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

      <TrackedItemsGrid profileId={profileId} dashboard={data} />
    </div>
  )
}

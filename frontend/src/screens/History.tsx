import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { TripSummary } from '../api/types'
import { useOutstandingEntityIds } from '../offline/useOutstandingIds'

const money = (n: number) => `$${n.toFixed(2)}`
const MONTHS_PER_PAGE = 6

function groupByMonth(trips: TripSummary[]) {
  const groups = new Map<string, TripSummary[]>()
  for (const trip of trips) {
    const key = trip.date.slice(0, 7) // YYYY-MM
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(trip)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, monthTrips]) => ({
      label: new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      total: monthTrips.reduce((sum, t) => sum + t.total, 0),
      trips: monthTrips,
    }))
}

export function History({ profileId }: { profileId: string }) {
  const { data: trips, isLoading } = useQuery({
    queryKey: ['trips', profileId],
    queryFn: () => api.trips(profileId).list(),
  })

  const pendingTripIds = useOutstandingEntityIds('trip')
  const groups = trips ? groupByMonth(trips) : []
  // Recent months first; older ones load on request instead of one endless page.
  const [monthsShown, setMonthsShown] = useState(MONTHS_PER_PAGE)

  if (isLoading || !trips) {
    return (
      <div className="mx-auto max-w-[900px] px-5 pt-6 pb-15">
        <div className="skel mb-4 h-6 w-24" />
        <div className="skel h-40" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[900px] px-4 pt-5 pb-15 sm:px-5 sm:pt-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h3 className="m-0">All trips</h3>
        {(trips?.length ?? 0) > 0 && (
          <Link to="/trends" className="btn btn-secondary btn-sm max-sm:min-h-11">
            Shopping trends
          </Link>
        )}
      </div>
      {trips?.length === 0 && (
        <p className="text-text/70">
          No trips yet.{' '}
          <Link to="/trips/new">Log one now.</Link>
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5.5">
        {groups.slice(0, monthsShown).map((group) => (
          <div key={group.label}>
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h4 className="m-0 text-lg">{group.label}</h4>
              <div className="flex items-center gap-2 text-xs text-text/70">
                <span>
                  {group.trips.length} {group.trips.length === 1 ? 'trip' : 'trips'}
                </span>
                <span className="tag tag-accent py-0.5 text-[13px] tabular-nums">{money(group.total)}</span>
              </div>
            </div>
            <div className="card elev-sm overflow-x-auto border border-divider p-0">
              <table className="table">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap">Date</th>
                    <th>Trip</th>
                    <th className="text-right max-sm:hidden">Items</th>
                    <th className="text-right">Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {group.trips.map((trip) => (
                    <tr key={trip.id}>
                      <td className="whitespace-nowrap">{trip.date}</td>
                      <td>
                        <span className="flex min-w-24 items-center gap-1.5">
                          {trip.name || trip.stores.join(', ') || '—'}
                          {pendingTripIds.has(trip.id) && <span className="tag tag-neutral text-[10px]">Pending sync</span>}
                        </span>
                      </td>
                      <td className="text-right max-sm:hidden">{trip.itemCount}</td>
                      <td className="text-right font-semibold">{money(trip.total)}</td>
                      <td className="text-right">
                        <Link to={`/trips/${trip.id}`} className="btn btn-ghost btn-sm max-sm:min-h-11">
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      {groups.length > monthsShown && (
        <button type="button" className="btn btn-secondary btn-block mt-5" onClick={() => setMonthsShown((n) => n + MONTHS_PER_PAGE)}>
          Show older months ({groups.length - monthsShown} more)
        </button>
      )}
    </div>
  )
}

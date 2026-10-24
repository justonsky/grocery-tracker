import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Category, TripSummary } from '../api/types'
import { useOutstandingEntityIds } from '../offline/useOutstandingIds'
import { listTrips } from '../trips/pendingTrips'
import { tripDateLabel } from '../dates'

const money = (n: number) => `$${n.toFixed(2)}`
const tripTitle = (trip: TripSummary) => trip.name || trip.stores.join(', ') || 'Trip'
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
  const queryClient = useQueryClient()
  const { data: trips, isLoading } = useQuery({
    queryKey: ['trips', profileId],
    queryFn: () =>
      listTrips(profileId, () => api.trips(profileId).list(), queryClient.getQueryData<Category[]>(['categories']), queryClient.getQueryData<TripSummary[]>(['trips', profileId])),
  })

  const pendingTripIds = useOutstandingEntityIds('trip')
  // History is what was shopped: finished trips, or ones with something bought. A list still
  // being planned has spent nothing; it lives under Grocery Trips until it's shopped.
  const shopped = trips?.filter((t) => t.status === 'done' || t.total > 0)
  const groups = shopped ? groupByMonth(shopped) : []
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
        {(shopped?.length ?? 0) > 0 && (
          <Link to="/trends" className="btn btn-secondary btn-sm max-sm:min-h-11">
            Shopping trends
          </Link>
        )}
      </div>
      {shopped?.length === 0 && (
        <div className="card elev-sm items-start gap-3">
          <p className="m-0 text-text/70">No trips yet. Finished trips show up here, by month.</p>
          <Link to="/trips/new" className="btn btn-primary max-sm:min-h-11">
            Start a shopping list
          </Link>
        </div>
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
            {/* Phone: one tappable row per trip, no sideways scrolling. */}
            <ul className="card elev-sm m-0 list-none divide-y divide-divider border border-divider p-0 sm:hidden">
              {group.trips.map((trip) => (
                <li key={trip.id}>
                  <Link to={`/trips/${trip.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 text-text no-underline">
                    <span className="w-14 shrink-0 text-sm text-text/70 tabular-nums">{tripDateLabel(trip.date, { year: false })}</span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate font-semibold">{tripTitle(trip)}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-text/60">
                        {trip.itemCount} {trip.itemCount === 1 ? 'item' : 'items'}
                        {trip.status === 'shopping' && <span className="tag tag-outline text-[10px]">Shopping</span>}
                        {pendingTripIds.has(trip.id) && <span className="tag tag-neutral text-[10px]">Pending sync</span>}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{money(trip.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="card elev-sm overflow-x-auto border border-divider p-0 max-sm:hidden">
              <table className="table">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap">Date</th>
                    <th>Trip</th>
                    <th className="text-right">Items</th>
                    <th className="text-right">Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {group.trips.map((trip) => (
                    <tr key={trip.id}>
                      <td className="whitespace-nowrap tabular-nums">{tripDateLabel(trip.date, { year: false })}</td>
                      <td>
                        <span className="flex min-w-24 items-center gap-1.5">
                          {tripTitle(trip)}
                          {trip.status === 'shopping' && <span className="tag tag-outline text-[10px]">Shopping</span>}
                          {pendingTripIds.has(trip.id) && <span className="tag tag-neutral text-[10px]">Pending sync</span>}
                        </span>
                      </td>
                      <td className="text-right tabular-nums">{trip.itemCount}</td>
                      <td className="text-right font-semibold tabular-nums">{money(trip.total)}</td>
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

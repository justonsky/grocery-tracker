import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { TripSummary } from '../api/types'

const money = (n: number) => `$${n.toFixed(2)}`

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

  const groups = trips ? groupByMonth(trips) : []

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[900px] px-5 pt-6 pb-15">
        <div className="skel mb-4 h-6 w-24" />
        <div className="skel h-40" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[900px] px-5 pt-6 pb-15">
      <h3 className="mb-4 text-lg">All trips</h3>
      {trips?.length === 0 && (
        <p className="text-text/70">
          No trips yet.{' '}
          <Link to="/trips/new">Log one now.</Link>
        </p>
      )}
      <div className="grid gap-5.5">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="mb-2 flex items-baseline justify-between">
              <h4 className="m-0">{group.label}</h4>
              <div className="text-xs text-text/70">
                {group.trips.length} {group.trips.length === 1 ? 'trip' : 'trips'} · {money(group.total)}
              </div>
            </div>
            <div className="card elev-sm p-0">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Store</th>
                    <th>Items</th>
                    <th className="text-right">Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {group.trips.map((trip) => (
                    <tr key={trip.id}>
                      <td>{trip.date}</td>
                      <td>{trip.storeName}</td>
                      <td>{trip.itemCount}</td>
                      <td className="text-right">{money(trip.total)}</td>
                      <td className="text-right">
                        <Link to={`/trips/${trip.id}`} className="btn btn-ghost px-2 py-0.5 text-xs">
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
    </div>
  )
}

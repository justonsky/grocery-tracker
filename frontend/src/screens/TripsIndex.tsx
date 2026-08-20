import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { TripSummary } from '../api/types'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { useToast } from '../components/ui/ToastProvider'
import { performOrQueue } from '../offline/performOrQueue'
import { useOutstandingEntityIds } from '../offline/useOutstandingIds'

const money = (n: number) => `$${n.toFixed(2)}`

export function TripsIndex({ profileId }: { profileId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const toast = useToast()

  const { data: trips, isLoading } = useQuery({ queryKey: ['trips', profileId], queryFn: () => api.trips(profileId).list() })
  const pendingTripIds = useOutstandingEntityIds('trip')

  const del = useMutation({
    networkMode: 'always',
    mutationFn: (tripId: string) =>
      performOrQueue(() => api.trips(profileId).delete(tripId), {
        entity: 'trip',
        action: 'delete',
        entityId: tripId,
        profileId,
        isCreate: false,
        payload: null,
        label: 'Delete trip',
      }),
    onSuccess: (outcome, tripId) => {
      // Remove it from view immediately either way — staying visible after
      // the user just deleted it would be confusing even though it's
      // technically still true until the delete syncs.
      queryClient.setQueryData<TripSummary[]>(['trips', profileId], (old) => old?.filter((t) => t.id !== tripId))
      queryClient.invalidateQueries({ queryKey: ['dashboard', profileId] })
      if (outcome.sent) {
        queryClient.invalidateQueries({ queryKey: ['trips', profileId] })
        toast('success', 'Trip deleted.')
      } else {
        toast('success', "Delete saved — will sync when you're back online.")
      }
    },
    onError: () => toast('error', "Couldn't delete that trip."),
  })

  const askDelete = async (tripId: string, label: string) => {
    const ok = await confirm({ title: `Delete "${label}"?` })
    if (ok) del.mutate(tripId)
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[900px] px-5 pt-6 pb-15">
        <div className="skel mb-4 h-6 w-32" />
        <div className="skel h-24" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[900px] px-5 pt-6 pb-15">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0">Trips</h3>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/trips/new')}>
          + New trip
        </button>
      </div>

      {trips?.length === 0 && (
        <div className="card elev-sm items-center gap-2.5 px-8 py-8 text-center">
          <p className="m-0 mb-2.5 text-text/70">No trips yet.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/trips/new')}>
            Log your first trip
          </button>
        </div>
      )}

      <div className="grid gap-3">
        {trips?.map((trip) => {
          // A trip written ahead of time has nothing ticked off yet.
          const label = trip.name || trip.date
          const summary = [
            `${trip.stores.length} ${trip.stores.length === 1 ? 'store' : 'stores'}`,
            `${trip.itemCount} ${trip.itemCount === 1 ? 'item' : 'items'}`,
            money(trip.total),
          ].join(' · ')
          return (
            <Link
              to={`/trips/${trip.id}`}
              key={trip.id}
              className="card elev-sm flex-row items-center justify-between gap-3 no-underline transition-transform hover:-translate-y-0.5 hover:shadow-md"
            >
              <div>
                <div className="card-title flex items-center gap-1.5 text-[15px]">
                  {label}
                  {trip.checkedCount < trip.itemCount && <span className="tag tag-outline text-[10px]">Planned</span>}
                  {pendingTripIds.has(trip.id) && <span className="tag tag-neutral text-[10px]">Pending sync</span>}
                </div>
                <div className="card-meta">
                  {/* An unnamed trip already shows its date as the title. */}
                  {trip.name ? `${trip.date} · ${summary}` : summary}
                  {trip.checkedCount < trip.itemCount && ` · ${trip.checkedCount}/${trip.itemCount} picked up`}
                </div>
              </div>
              <button
                type="button"
                aria-label="Delete trip"
                className="btn btn-ghost btn-icon"
                style={{ color: 'var(--color-danger)' }}
                onClick={(e) => {
                  e.preventDefault()
                  askDelete(trip.id, label)
                }}
              >
                ×
              </button>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

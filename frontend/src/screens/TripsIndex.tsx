import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { TripStatus, TripSummary } from '../api/types'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { useToast } from '../components/ui/ToastProvider'
import { performOrQueue } from '../offline/performOrQueue'
import { useOutstandingEntityIds } from '../offline/useOutstandingIds'

const money = (n: number) => `$${n.toFixed(2)}`
const PAGE = 12
const STATUS_TAG: Record<TripStatus, string> = { planned: 'Planned', shopping: 'Shopping', done: 'Done' }

// What's worth knowing at a glance depends on the stage: a plan's estimate,
// progress through a shop, or how a finished trip compared with its estimate.
function describe(trip: TripSummary): string {
  // Store names (not just a count), so a search by store shows why a trip matched.
  const storeNames = trip.stores.length > 2 ? `${trip.stores.slice(0, 2).join(', ')} +${trip.stores.length - 2}` : trip.stores.join(', ')
  const parts = [storeNames, `${trip.itemCount} ${trip.itemCount === 1 ? 'item' : 'items'}`].filter(Boolean)
  if (trip.status === 'planned') {
    if (trip.estimatedTotal > 0) parts.push(`est. ${money(trip.estimatedTotal)}`)
  } else {
    parts.push(money(trip.total))
    if (trip.status === 'shopping') parts.push(`${trip.checkedCount}/${trip.itemCount} picked up`)
    if (trip.savings != null && trip.savings !== 0) {
      parts.push(trip.savings > 0 ? `${money(trip.savings)} under estimate` : `${money(-trip.savings)} over estimate`)
    }
  }
  return parts.join(' · ')
}

export function TripsIndex({ profileId }: { profileId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(PAGE)

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

  // Lists in progress stay on top; finished trips are searchable and paged, so
  // years of history don't turn this into one endless scroll.
  const active = trips?.filter((t) => t.status !== 'done') ?? []
  const past = trips?.filter((t) => t.status === 'done') ?? []
  const q = search.trim().toLowerCase()
  const matching = q
    ? past.filter((t) => [t.name ?? '', t.date, ...t.stores].some((field) => field.toLowerCase().includes(q)))
    : past

  const renderTrip = (trip: TripSummary) => {
    const label = trip.name || trip.date
    const summary = describe(trip)
    return (
      <Link
        to={`/trips/${trip.id}`}
        key={trip.id}
        className="card elev-sm flex-row items-center justify-between gap-3 no-underline transition-transform hover:-translate-y-0.5 hover:shadow-md"
      >
        <div>
          <div className="card-title flex items-center gap-1.5 text-[15px]">
            {label}
            <span className={`tag text-[10px] ${trip.status === 'done' ? 'tag-neutral' : 'tag-outline'}`}>
              {STATUS_TAG[trip.status]}
            </span>
            {pendingTripIds.has(trip.id) && <span className="tag tag-neutral text-[10px]">Pending sync</span>}
          </div>
          <div className="card-meta">
            {/* An unnamed trip already shows its date as the title. */}
            {trip.name ? `${trip.date} · ${summary}` : summary}
          </div>
        </div>
        <button
          type="button"
          aria-label="Shop again from this trip"
          title="Shop again — new list with these items"
          className="btn btn-ghost btn-icon ml-auto"
          onClick={(e) => {
            e.preventDefault()
            navigate(`/trips/new?from=${trip.id}`)
          }}
        >
          ↻
        </button>
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
  }

  if (isLoading || !trips) {
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
          + New list
        </button>
      </div>

      {trips?.length === 0 && (
        <div className="card elev-sm items-center gap-2.5 px-8 py-8 text-center">
          <p className="m-0 mb-2.5 text-text/70">No trips yet. Start with a shopping list, or log a shop you've already done.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/trips/new')}>
            Start a shopping list
          </button>
        </div>
      )}

      {active.length > 0 && (
        <section aria-labelledby="trips-active" className="mb-6">
          <h4 id="trips-active" className="mb-2">
            In progress
          </h4>
          <div className="grid gap-3">{active.map(renderTrip)}</div>
        </section>
      )}

      {past.length > 0 && (
        <section aria-labelledby="trips-past">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h4 id="trips-past" className="m-0">
              Past trips <span className="text-sm font-normal text-text/55">· {past.length}</span>
            </h4>
            <input
              className="input w-full sm:w-60"
              type="search"
              placeholder="Search by name, store or date"
              aria-label="Search past trips"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setShown(PAGE)
              }}
            />
          </div>
          {matching.length === 0 && <p className="text-sm text-text/70">No past trips match "{search}".</p>}
          <div className="grid gap-3">{matching.slice(0, shown).map(renderTrip)}</div>
          {matching.length > shown && (
            <button type="button" className="btn btn-secondary btn-block" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, matching.length - shown)} more of {matching.length - shown}
            </button>
          )}
        </section>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Category, TripStatus, TripSummary } from '../api/types'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { useToast } from '../components/ui/ToastProvider'
import { performOrQueue } from '../offline/performOrQueue'
import { useOutstandingEntityIds } from '../offline/useOutstandingIds'
import { useReceiptImport } from '../receipts/useReceiptImport'
import { listTrips } from '../trips/pendingTrips'
import { tripDateLabel } from '../dates'

const money = (n: number) => `$${n.toFixed(2)}`
const PAGE = 12
const STATUS_TAG: Record<TripStatus, string> = { planned: 'Planned', shopping: 'Shopping', done: 'Done' }

const STATUS_TAG_CLASS: Record<TripStatus, string> = { planned: 'tag-neutral', shopping: 'tag-outline', done: 'tag-accent' }

const RepeatIcon = () => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
)
const TrashIcon = () => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </svg>
)

// What's worth knowing at a glance depends on the stage: a plan's estimate,
// progress through a shop, or how a finished trip compared with its estimate.
function describe(trip: TripSummary): string {
  const parts = [`${trip.itemCount} ${trip.itemCount === 1 ? 'item' : 'items'}`]
  if (trip.status === 'shopping') parts.push(`${trip.checkedCount}/${trip.itemCount} picked up`)
  return parts.join(' · ')
}

export function TripsIndex({ profileId }: { profileId: string }) {
  const navigate = useNavigate()
  const receipts = useReceiptImport()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [shown, setShown] = useState(PAGE)

  const { data: trips, isLoading } = useQuery({
    queryKey: ['trips', profileId],
    queryFn: () =>
      listTrips(profileId, () => api.trips(profileId).list(), queryClient.getQueryData<Category[]>(['categories']), queryClient.getQueryData<TripSummary[]>(['trips', profileId])),
  })
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
    ? past.filter((t) => [t.name ?? '', t.date, tripDateLabel(t.date), ...t.stores].some((field) => field.toLowerCase().includes(q)))
    : past

  const renderTrip = (trip: TripSummary) => {
    const label = trip.name || tripDateLabel(trip.date)
    // Store names (not just a count), so a search by store shows why a trip matched.
    const shownStores = trip.stores.slice(0, 3)
    const moreStores = trip.stores.length - shownStores.length
    const amount = trip.status === 'planned' ? (trip.estimatedTotal > 0 ? `est. ${money(trip.estimatedTotal)}` : null) : money(trip.total)
    return (
      // The title link stretches over the card (its ::after), so the whole card opens the trip
      // while the action buttons stay real buttons beside it — not nested inside a link.
      <div
        key={trip.id}
        className="card elev-sm relative flex-row items-center gap-1 border border-divider py-3 pr-1.5 pl-4 text-text transition-transform hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="min-w-0 flex-1">
          <div className="card-title flex flex-wrap items-center gap-x-2 gap-y-1 text-[16px]">
            <Link to={`/trips/${trip.id}`} className="min-w-0 truncate text-text no-underline after:absolute after:inset-0 after:rounded-[18px]">
              {label}
            </Link>
            <span className={`tag py-0.5 text-[10px] ${STATUS_TAG_CLASS[trip.status]}`}>{STATUS_TAG[trip.status]}</span>
            {pendingTripIds.has(trip.id) && <span className="tag tag-neutral py-0.5 text-[10px]">Pending sync</span>}
          </div>
          {/* An unnamed trip already shows its date as the title. */}
          <div className="card-meta mt-1">{trip.name ? `${tripDateLabel(trip.date)} · ${describe(trip)}` : describe(trip)}</div>
          {(shownStores.length > 0 || trip.savings != null) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {shownStores.map((s) => (
                <span key={s} className="tag tag-neutral py-0.5 text-[11px]">
                  {s}
                </span>
              ))}
              {moreStores > 0 && <span className="tag tag-neutral py-0.5 text-[11px]">+{moreStores}</span>}
              {trip.status !== 'planned' && trip.savings != null && trip.savings !== 0 && (
                <span
                  className={`tag py-0.5 text-[11px] tabular-nums ${trip.savings > 0 ? 'tag-accent' : 'tag-neutral text-danger'}`}
                >
                  {trip.savings > 0 ? `${money(trip.savings)} under estimate` : `${money(-trip.savings)} over estimate`}
                </span>
              )}
            </div>
          )}
        </div>
        {amount && <div className="shrink-0 pr-1 text-right font-heading text-lg font-bold tabular-nums">{amount}</div>}
        {/* Stacked on a phone, so the title, tags and amount get the width. */}
        <div className="relative z-10 flex shrink-0 max-sm:flex-col">
          <button
            type="button"
            aria-label={`Shop again from ${label}`}
            title="Shop again — new list with these items"
            className="btn btn-ghost btn-icon"
            onClick={() => navigate(`/trips/new?from=${trip.id}`)}
          >
            <RepeatIcon />
          </button>
          <button
            type="button"
            aria-label={`Delete ${label}`}
            className="btn btn-ghost btn-icon text-danger hover:bg-danger-bg"
            onClick={() => askDelete(trip.id, label)}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
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
    <div className="mx-auto max-w-[900px] px-4 pt-5 pb-15 sm:px-5 sm:pt-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0">Grocery Trips</h3>
        <div className="flex flex-wrap gap-2">
          {receipts.available && (
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/trips/new?import=receipt')}>
              Import receipt
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => navigate('/trips/new')}>
            + New list
          </button>
        </div>
      </div>

      {trips?.length === 0 && (
        <div className="card elev-sm items-center gap-2.5 border border-divider px-8 py-8 text-center">
          <p className="m-0 mb-2.5 text-text/70">No trips yet. Start with a shopping list, or log a shop you've already done.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/trips/new')}>
            Start a shopping list
          </button>
        </div>
      )}

      {active.length > 0 && (
        <section aria-labelledby="trips-active" className="mb-6">
          <h4 id="trips-active" className="mb-2.5 text-lg">
            In progress
          </h4>
          <div className="grid gap-3">{active.map(renderTrip)}</div>
        </section>
      )}

      {past.length > 0 && (
        <section aria-labelledby="trips-past">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <h4 id="trips-past" className="m-0 text-lg">
              Past trips <span className="text-sm font-normal text-text/60">· {past.length}</span>
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
            <button type="button" className="btn btn-secondary btn-block mt-3" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, matching.length - shown)} more of {matching.length - shown}
            </button>
          )}
        </section>
      )}
    </div>
  )
}

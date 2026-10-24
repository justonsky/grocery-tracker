import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { DashboardSummary, TrackedItem } from '../api/types'
import { useDebounce } from '../hooks/useDebounce'
import { performOrQueue } from '../offline/performOrQueue'
import { useToast } from './ui/ToastProvider'
import { Combobox } from './ui/Combobox'
import { perUnit } from '../trips/quantity'

const money = (n: number) => `$${n.toFixed(2)}`
const normalize = (s: string) => s.trim().toLowerCase()

function Sparkline({ prices }: { prices: number[] }) {
  if (prices.length < 2) return <svg width="100%" height="44" viewBox="0 0 100 44" className="block" aria-hidden="true" />
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const step = 100 / (prices.length - 1)
  const points = prices.map((p, i) => `${i * step},${40 - ((p - min) / range) * 34}`)
  const line = `M${points.join(' L')}`
  return (
    <svg width="100%" height="44" viewBox="0 0 100 44" preserveAspectRatio="none" className="block" aria-hidden="true">
      <path d={`${line} L100,44 L0,44 Z`} fill="var(--chart-1)" fillOpacity={0.14} />
      <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// Coral is kept for the screen's one call to action, so a price rise is an outlined tag.
const TREND_TAG: Record<TrackedItem['trend'], string> = { up: 'tag-outline', down: 'tag-accent', flat: 'tag-neutral' }
const trendLabel = (item: TrackedItem) => {
  if (item.deltaFromPrevious == null) return '—'
  const sign = item.deltaFromPrevious > 0 ? '+' : item.deltaFromPrevious < 0 ? '−' : ''
  return `${sign}${money(Math.abs(item.deltaFromPrevious))}`
}
const trendDescription = (item: TrackedItem) =>
  item.deltaFromPrevious == null
    ? 'Bought once so far'
    : item.deltaFromPrevious === 0
      ? 'Same price as the purchase before'
      : `${item.deltaFromPrevious > 0 ? 'Up' : 'Down'} ${money(Math.abs(item.deltaFromPrevious))} from the purchase before`

// The dashboard's item grid: the 8 most recently bought items until the profile
// picks its own (add / remove / reset). The whole grid is one outbox op keyed by
// profile, so edits work offline and coalesce into a single request.
export function TrackedItemsGrid({ profileId, dashboard }: { profileId: string; dashboard: DashboardSummary }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [newItemName, setNewItemName] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 250)

  const { data: catalogue } = useQuery({ queryKey: ['items'], queryFn: () => api.items.search() })
  const { data: searchResults } = useQuery({
    queryKey: ['tracked-items', profileId, debouncedSearch],
    queryFn: () => api.trackedItems(profileId).search(debouncedSearch),
    enabled: !!debouncedSearch,
  })

  const grid = dashboard.trackedItems
  const gridIds = useMemo(() => new Set(grid.map((t) => t.itemId)), [grid])
  const addOptions = useMemo(
    () =>
      (catalogue ?? [])
        .filter((i) => !gridIds.has(i.id))
        .map((i) => ({ value: i.id, label: i.name, hint: i.lastPrice != null ? money(i.lastPrice) : undefined })),
    [catalogue, gridIds],
  )
  const shown = debouncedSearch ? (searchResults ?? []) : grid

  const setGrid = useMutation({
    networkMode: 'always',
    mutationFn: async ({ itemIds, optimistic }: { itemIds: string[] | null; optimistic: TrackedItem[] | null }) => {
      // Show an add/remove at once, online or not; the server's copy replaces it on
      // success. A reset can't be shown ahead of the server (only it knows the
      // recent purchases), so it has no optimistic step.
      if (optimistic) {
        queryClient.setQueryData<DashboardSummary>(['dashboard', profileId], (old) =>
          old ? { ...old, trackedItems: optimistic, trackedItemsCustomized: true } : old,
        )
      }
      return performOrQueue(() => api.trackedItems(profileId).set(itemIds), {
        entity: 'tracked-items',
        action: 'put',
        entityId: profileId,
        profileId,
        isCreate: false,
        payload: { itemIds },
        label: itemIds === null ? 'Reset dashboard items' : 'Dashboard items',
      })
    },
    onSuccess: (outcome, { itemIds }) => {
      if (outcome.sent) queryClient.invalidateQueries({ queryKey: ['dashboard', profileId] })
      else if (itemIds === null) toast('success', "Your dashboard will reset to recent items once you're back online.")
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', profileId] })
      toast('error', "Couldn't update your tracked items.")
    },
  })

  // A just-added item has no stats in the dashboard cache yet; the catalogue's
  // last price stands in until the server's copy arrives.
  const placeholderFor = (itemId: string): TrackedItem | null => {
    const fromSearch = searchResults?.find((t) => t.itemId === itemId)
    if (fromSearch) return fromSearch
    const item = catalogue?.find((i) => i.id === itemId)
    if (!item) return null
    return { itemId, itemName: item.name, categoryName: '', lastPrice: item.lastPrice, recentPrices: [], trend: 'flat', deltaFromPrevious: null }
  }

  const add = (itemId: string) => {
    if (gridIds.has(itemId)) return
    const placeholder = placeholderFor(itemId)
    if (!placeholder) return
    setGrid.mutate({ itemIds: [...grid.map((t) => t.itemId), itemId], optimistic: [...grid, placeholder] })
  }
  const remove = (itemId: string) => {
    const next = grid.filter((t) => t.itemId !== itemId)
    setGrid.mutate({ itemIds: next.map((t) => t.itemId), optimistic: next })
  }
  const reset = () => setGrid.mutate({ itemIds: null, optimistic: null })

  const addByName = () => {
    const match = catalogue?.find((i) => normalize(i.name) === normalize(newItemName))
    if (!match) {
      toast('error', `No item called "${newItemName.trim()}" yet — add it from the Items page first.`)
      return
    }
    if (gridIds.has(match.id)) {
      toast('success', `${match.name} is already on your dashboard.`)
    } else {
      add(match.id)
    }
    setNewItemName('')
  }

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[22px]">Items you're tracking</h2>
          <p className="m-0 mt-0.5 text-[13px] text-text/70">
            {dashboard.trackedItemsCustomized
              ? 'Your picks'
              : dashboard.recentTrip
                ? 'Your most recent purchases — edit to choose your own'
                : 'Recent household purchases — edit to choose your own'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-text/60"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              className="input pl-10"
              type="search"
              placeholder="Search items"
              aria-label="Search purchased items"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button type="button" className={editing ? 'btn btn-primary px-5' : 'btn btn-secondary px-5'} onClick={() => setEditing((e) => !e)}>
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {editing && !debouncedSearch && (
        <div className="card elev-sm mb-3.5 gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Combobox
              wrapperClassName="flex-1"
              placeholder="Add an item to your dashboard"
              aria-label="Item to add"
              value={newItemName}
              onChange={setNewItemName}
              options={addOptions}
              // Picking a suggestion adds it at once.
              onSelect={(option) => {
                add(option.value)
                setNewItemName('')
              }}
              onKeyDown={(e) => e.key === 'Enter' && newItemName.trim() && addByName()}
            />
            <button type="button" className="btn btn-secondary shrink-0" disabled={!newItemName.trim()} onClick={addByName}>
              Add
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text/60">
            <span>Remove an item with the × on its card. Search above to track something you've bought before.</span>
            {dashboard.trackedItemsCustomized && (
              <button type="button" className="btn btn-ghost px-2 text-xs" onClick={reset}>
                Reset to recent items
              </button>
            )}
          </div>
        </div>
      )}

      {debouncedSearch && shown.length === 0 && <p className="text-text/70">No purchased items match "{searchQuery}".</p>}
      {!debouncedSearch && shown.length === 0 && (
        <div className="card elev-sm items-center px-6 py-6 text-center text-sm text-text/70">
          {dashboard.trackedItemsCustomized
            ? 'No items on your dashboard. Use Edit to add some.'
            : 'Items appear here once you log what you paid for them.'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-3.5 lg:grid-cols-4">
        {shown.map((item) => {
          const tracked = gridIds.has(item.itemId)
          return (
            <div key={item.itemId} className="relative flex flex-col gap-2">
              <Link
                to={`/items/${item.itemId}`}
                className="card elev-sm min-h-[44px] flex-1 cursor-pointer gap-2.5 p-3.5 text-text sm:p-[18px] no-underline transition-transform hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className={`min-w-0 text-[15px] font-bold break-words ${editing && !debouncedSearch ? 'pr-11' : ''}`}>{item.itemName}</div>
                  {!editing && (
                    <span className={`tag shrink-0 px-2.5 py-0.5 tabular-nums ${TREND_TAG[item.trend]}`} title={trendDescription(item)} aria-label={trendDescription(item)}>
                      {trendLabel(item)}
                    </span>
                  )}
                </div>
                <Sparkline prices={item.recentPrices} />
                <div className="card-meta justify-between text-[13px] text-text/70">
                  <span className="truncate">{item.categoryName}</span>
                  <span className="shrink-0 font-bold text-text tabular-nums">
                    {item.lastPrice != null ? `${money(item.lastPrice)}${perUnit(item.priceUnit)}` : <span className="font-normal text-text/70">Not bought yet</span>}
                  </span>
                </div>
              </Link>
              {editing && !debouncedSearch && (
                <button
                  type="button"
                  aria-label={`Remove ${item.itemName} from your dashboard`}
                  className="btn btn-secondary btn-icon absolute top-1.5 right-1.5 bg-surface"
                  onClick={() => remove(item.itemId)}
                >
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              )}
              {debouncedSearch && (
                <button
                  type="button"
                  aria-label={tracked ? `${item.itemName} is on your dashboard` : `Track ${item.itemName} on your dashboard`}
                  disabled={tracked}
                  className="btn btn-secondary w-full"
                  onClick={() => add(item.itemId)}
                >
                  {tracked ? 'Tracking' : '+ Track'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { ProblemTypes } from '../api/problemTypes'
import { useConnectivity } from '../app/ConnectivityProvider'
import { useToast } from '../components/ui/ToastProvider'
import { useDebounce } from '../hooks/useDebounce'
import { ItemEditor, invalidateItemData } from './ItemEditor'
import { perUnit } from '../trips/quantity'
import { tripDateLabel } from '../dates'

const money = (n: number) => `$${n.toFixed(2)}`
const ITEMS_PER_PAGE = 40

// The Items portal: the household catalogue and every purchase record behind it.
// Edits here go straight to the server (not the offline outbox), so the page is
// read-only without a connection. ?item=<id> selects an item; on a phone the
// editor replaces the list, on a wide screen they sit side by side.
export function ItemsPortal() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { status } = useConnectivity()
  const online = status === 'online'
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('item')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 200)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  // A household catalogue runs to a thousand-plus items: show a page, search for the rest.
  const [itemsShown, setItemsShown] = useState(ITEMS_PER_PAGE)

  const { data: items, isLoading } = useQuery({
    queryKey: ['catalog', debouncedSearch],
    queryFn: () => api.catalog.list(debouncedSearch || undefined),
  })
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories.list })

  const select = (id: string | null) => setSearchParams(id ? { item: id } : {}, { replace: !!selectedId && !!id })

  const create = useMutation({
    mutationFn: (name: string) => api.catalog.create({ name, defaultCategoryId: categories?.find((c) => c.name === 'Other')?.id ?? null }),
    onSuccess: (item) => {
      invalidateItemData(queryClient)
      setCreating(false)
      setNewName('')
      select(item.id)
    },
    onError: (error) =>
      toast(
        'error',
        error instanceof ApiError && error.problemType === ProblemTypes.ItemNameConflict
          ? 'An item with that name already exists.'
          : "Couldn't create that item.",
      ),
  })

  return (
    <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-15 sm:px-5">
      {!online && (
        <div className="card elev-sm mb-4 text-sm leading-relaxed text-text/80">
          Editing items needs a connection to your home server. You can look, but changes are turned off until you're back online.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
        {/* List — hidden on small screens while an item is open. */}
        <div className={selectedId ? 'hidden lg:block' : ''}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="m-0 text-2xl">Items</h3>
            <button type="button" className="btn btn-primary" disabled={!online} onClick={() => setCreating(true)}>
              + New item
            </button>
          </div>
          {creating && (
            <div className="card elev-md mb-3 gap-2.5">
              <input
                className="input"
                placeholder="Item name"
                aria-label="New item name"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newName.trim() && create.mutate(newName.trim())}
              />
              <div className="flex justify-end gap-1.5">
                <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" disabled={!newName.trim() || create.isPending} onClick={() => create.mutate(newName.trim())}>
                  Create
                </button>
              </div>
            </div>
          )}
          <input
            className="input mb-3"
            type="search"
            placeholder="Search items…"
            aria-label="Search items"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setItemsShown(ITEMS_PER_PAGE)
            }}
          />
          {isLoading && <div className="skel h-40 rounded-[18px]" />}
          {items?.length === 0 && <p className="mb-3 text-sm text-text/70">{debouncedSearch ? 'No items match.' : 'No items yet.'}</p>}
          <div className="card elev-sm max-h-none gap-0 overflow-hidden p-0 lg:max-h-[calc(100dvh-220px)] lg:overflow-y-auto">
            {items?.slice(0, itemsShown).map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={item.id === selectedId ? 'true' : undefined}
                onClick={() => select(item.id)}
                className={`flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 border-0 border-b border-divider px-4 py-2.5 text-left font-body last:border-b-0 ${
                  item.id === selectedId ? 'bg-accent-800' : 'bg-transparent hover:bg-chip'
                }`}
              >
                <span className="min-w-0">
                  <span className={`block truncate text-sm text-text ${item.id === selectedId ? 'font-bold' : 'font-semibold'}`}>{item.name}</span>
                  <span className="block text-xs text-text/60">
                    {item.categoryName} · {item.purchaseCount} {item.purchaseCount === 1 ? 'purchase' : 'purchases'}
                    {item.lastPurchased && ` · last ${tripDateLabel(item.lastPurchased)}`}
                  </span>
                </span>
                {item.averagePrice != null && <span className="tag tag-neutral shrink-0 px-2.5 py-0.5 tabular-nums">avg {money(item.averagePrice)}{perUnit(item.priceUnit)}</span>}
              </button>
            ))}
            {items && items.length > itemsShown && (
              <button
                type="button"
                className="btn btn-ghost w-full rounded-none"
                onClick={() => setItemsShown((n) => n + ITEMS_PER_PAGE)}
              >
                Show {Math.min(ITEMS_PER_PAGE, items.length - itemsShown)} more of {items.length - itemsShown}
              </button>
            )}
          </div>
          {items && items.length > ITEMS_PER_PAGE && !debouncedSearch && (
            <p className="mt-2 text-center text-xs text-text/60">{items.length} items — search to find one quickly.</p>
          )}
        </div>

        <div className={selectedId ? '' : 'hidden lg:block'}>
          {selectedId ? (
            <ItemEditor key={selectedId} itemId={selectedId} online={online} onClose={() => select(null)} onSelect={select} />
          ) : (
            <div className="card elev-sm items-center px-6 py-12 text-center text-sm text-text/60">
              Pick an item to rename it, fix its purchase records, or merge it into another.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toJpeg, toPng } from 'html-to-image'
import { api, ApiError } from '../api/client'
import { ProblemTypes } from '../api/problemTypes'
import type { Trip, TripInput, TripItemInput, TripStatus } from '../api/types'
import { useToast } from '../components/ui/ToastProvider'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { ShareableListCard } from '../components/ShareableListCard'
import { Combobox, type ComboOption } from '../components/ui/Combobox'
import { TripItemList, type DraftItem } from '../components/TripItemList'
import { performOrQueue, newClientId } from '../offline/performOrQueue'
import { summarize, summarizeByStore } from '../trips/costSummary'

const todayIso = () => new Date().toISOString().slice(0, 10)
const money = (n: number) => `$${n.toFixed(2)}`
const normalize = (name: string) => name.trim().toLowerCase()

// Amounts stay strings while editing so a field can be left blank; blank (or
// negative) means "not known", not zero.
const parseAmount = (value: string) => {
  const n = Number.parseFloat(value)
  return value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null
}
const amountText = (n: number | null) => (n != null ? String(n) : '')

// What the screen is called at each stage: a list you plan with, then the shop
// itself, then the record of it.
const TITLE: Record<TripStatus, string> = { planned: 'Shopping list', shopping: 'Shopping', done: 'Trip' }
const SAVED: Record<TripStatus, string> = { planned: 'List saved.', shopping: 'Saved — happy shopping.', done: 'Trip finished.' }

const randomKey = () => Math.random().toString(36).slice(2, 9)
const newItem = (categoryId: string): DraftItem => ({
  key: randomKey(),
  id: null,
  itemName: '',
  categoryId,
  storeName: null,
  checked: false,
  estimate: '',
  price: '',
  locked: false,
  priceLocksAt: null,
})

// Keyed so that moving between trips — or from a trip to "shop again" from it —
// always starts a fresh editor instead of carrying one trip's id into another.
export function TripEditor({ profileId }: { profileId: string }) {
  const { tripId } = useParams()
  const [searchParams] = useSearchParams()
  return <TripEditorScreen key={tripId ?? `new:${searchParams.get('from') ?? ''}`} profileId={profileId} />
}

function TripEditorScreen({ profileId }: { profileId: string }) {
  const { tripId } = useParams()
  const [searchParams] = useSearchParams()
  const copyFromId = tripId ? null : searchParams.get('from')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const isEditing = Boolean(tripId)

  // One id for the life of this screen, so saving a new trip more than once
  // (say "Start shopping", then "Save") keeps updating the same trip.
  const [id] = useState(() => tripId ?? newClientId())
  const [persisted, setPersisted] = useState(isEditing)

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories.list })
  const { data: existingTrip } = useQuery({
    queryKey: ['trip', profileId, tripId],
    queryFn: () => api.trips(profileId).get(tripId!),
    enabled: isEditing,
  })
  const { data: sourceTrip, isError: sourceFailed } = useQuery({
    queryKey: ['trip', profileId, copyFromId],
    queryFn: () => api.trips(profileId).get(copyFromId!),
    enabled: Boolean(copyFromId),
  })
  // Full item/store lists back the autocomplete fields below — small
  // enough per profile that fetching once beats debouncing per keystroke.
  // Household-wide, so these (and the averages behind "fill estimates") include
  // what every profile has bought.
  const { data: itemSuggestions } = useQuery({ queryKey: ['items'], queryFn: () => api.items.search() })
  const { data: storeSuggestions } = useQuery({ queryKey: ['stores'], queryFn: () => api.stores.search() })

  const [name, setName] = useState('')
  const [date, setDate] = useState(todayIso())
  const [budget, setBudget] = useState('')
  const [status, setStatus] = useState<TripStatus>('planned')
  const [stores, setStores] = useState<string[]>([])
  const [newStoreName, setNewStoreName] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])

  // What the form held right after it last loaded a server copy, to tell
  // whether anything has been edited since.
  const loadedSnapshotRef = useRef<string | null>(null)
  const snapshot = (draft: { name: string; date: string; budget: string; status: TripStatus; stores: string[]; items: DraftItem[] }) =>
    JSON.stringify({ ...draft, items: draft.items.map(({ key: _key, ...rest }) => rest) })

  const hydrate = (trip: Trip) => {
    const draft = {
      name: trip.name ?? '',
      date: trip.date,
      budget: amountText(trip.budget),
      status: trip.status,
      stores: trip.stores,
      items: trip.items.map((it) => ({
        key: it.id,
        id: it.id,
        itemName: it.itemName,
        categoryId: it.categoryId,
        storeName: it.storeName,
        checked: it.checked,
        estimate: amountText(it.estimate),
        price: amountText(it.price),
        locked: it.priceLocked,
        priceLocksAt: it.priceLocksAt,
      })),
    }
    setName(draft.name)
    setDate(draft.date)
    setBudget(draft.budget)
    setStatus(draft.status)
    setStores(draft.stores)
    setItems(draft.items)
    loadedSnapshotRef.current = snapshot(draft)
  }

  useEffect(() => {
    if (existingTrip) {
      // A refetch (window focus, or the outbox syncing a queued save) must not
      // wipe edits made since the last load: only take the server's copy while
      // the form is still exactly what was last loaded.
      const edited =
        loadedSnapshotRef.current !== null &&
        snapshot({ name, date, budget, status, stores, items }) !== loadedSnapshotRef.current
      if (!edited) hydrate(existingTrip)
    } else if (sourceTrip) {
      // Shopping again from a past trip: same name, stores and items, as a
      // fresh plan — nothing ticked off, priced or estimated yet.
      setName(sourceTrip.name ?? '')
      setStores(sourceTrip.stores)
      setItems(
        sourceTrip.items.map((it) => ({
          ...newItem(it.categoryId),
          itemName: it.itemName,
          storeName: it.storeName,
        })),
      )
    } else if (categories && items.length === 0 && !isEditing && (!copyFromId || sourceFailed)) {
      setItems([newItem(categories[0]?.id ?? '')])
    }
  }, [existingTrip, sourceTrip, sourceFailed, categories, isEditing, copyFromId]) // eslint-disable-line react-hooks/exhaustive-deps

  const defaultCategoryId = categories?.[0]?.id ?? ''

  const save = useMutation({
    // See ProfilePicker's create — without this, useMutation pauses entirely while
    // offline instead of ever reaching performOrQueue's own fallback logic.
    networkMode: 'always',
    mutationFn: async ({ status: nextStatus }: { status: TripStatus; leave: boolean }) => {
      const cleanItems: TripItemInput[] = items
        .filter((r) => r.itemName.trim())
        .map((r) => ({
          id: r.id,
          itemName: r.itemName,
          categoryId: r.categoryId,
          storeName: r.storeName,
          checked: r.checked,
          estimate: parseAmount(r.estimate),
          price: parseAmount(r.price),
        }))
      const input: TripInput = {
        name: name.trim() || null,
        date,
        budget: parseAmount(budget),
        stores,
        items: cleanItems,
        status: nextStatus,
      }

      return performOrQueue(() => api.trips(profileId).upsert(id, input), {
        entity: 'trip',
        action: 'put',
        entityId: id,
        profileId,
        isCreate: !persisted,
        payload: input,
        // Harmless even when these categories are already synced — only
        // blocks the trip if a matching category op is itself failed/blocked.
        dependsOn: Array.from(new Set(cleanItems.map((i) => i.categoryId))),
        label: `Trip "${input.name || input.date}"`,
      })
    },
    onSuccess: (outcome, { status: nextStatus, leave }) => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', profileId] })
      queryClient.invalidateQueries({ queryKey: ['trips', profileId] })
      queryClient.invalidateQueries({ queryKey: ['items'] })
      queryClient.invalidateQueries({ queryKey: ['stores'] })
      queryClient.invalidateQueries({ queryKey: ['item-history'] })
      setPersisted(true)
      setStatus(nextStatus)

      const queuedMessage = "Saved on this device — will sync when you're back online."
      if (leave) {
        toast('success', outcome.sent ? SAVED[nextStatus] : queuedMessage)
        navigate('/trips')
        return
      }

      // Staying on the trip (a status change): take the server's copy so new
      // lines get their ids and lock dates. A new trip moves to its own URL;
      // the cache entry set here is what the remounted editor loads from.
      if (outcome.sent) {
        queryClient.setQueryData(['trip', profileId, id], outcome.result)
        hydrate(outcome.result)
        if (!isEditing) navigate(`/trips/${id}`, { replace: true })
      }
      toast('success', outcome.sent ? SAVED[nextStatus] : queuedMessage)
    },
    onError: (error) =>
      toast(
        'error',
        error instanceof ApiError && error.problemType === ProblemTypes.PriceLocked
          ? `${error.message} Reload the trip to see its current prices.`
          : "Couldn't save this trip.",
      ),
  })

  const del = useMutation({
    networkMode: 'always',
    mutationFn: () =>
      performOrQueue(() => api.trips(profileId).delete(tripId!), {
        entity: 'trip',
        action: 'delete',
        entityId: tripId!,
        profileId,
        isCreate: false,
        payload: null,
        label: `Delete trip "${name || date}"`,
      }),
    onSuccess: (outcome) => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', profileId] })
      queryClient.invalidateQueries({ queryKey: ['trips', profileId] })
      toast('success', outcome.sent ? 'Trip deleted.' : "Delete saved — will sync when you're back online.")
      navigate('/trips')
    },
    onError: () => toast('error', "Couldn't delete this trip."),
  })

  const askDelete = async () => {
    const ok = await confirm({ title: 'Delete this trip?', body: 'This permanently removes the trip and its items.' })
    if (ok) del.mutate()
  }

  const addStore = (name = newStoreName) => {
    const trimmed = name.trim()
    if (!trimmed || stores.some((s) => s.toLowerCase() === trimmed.toLowerCase())) return
    setStores((s) => [...s, trimmed])
    setNewStoreName('')
  }
  const removeStore = (storeName: string) => {
    setStores((s) => s.filter((x) => x !== storeName))
    setItems((its) => its.map((it) => (it.storeName === storeName && !it.locked ? { ...it, storeName: null } : it)))
  }

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    // Ticking something off or paying for it means the shop has started.
    if ((patch.checked || patch.price) && status === 'planned') setStatus('shopping')
    setItems((its) => its.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }
  const removeItem = (key: string) => setItems((its) => its.filter((it) => it.key !== key))
  const addItem = (storeName: string | null = null) => setItems((its) => [...its, { ...newItem(defaultCategoryId), storeName }])

  // Picking a known item carries over the category that item last used.
  const setItemName = (key: string, value: string) => {
    const match = itemSuggestions?.find((i) => normalize(i.name) === normalize(value))
    updateItem(key, match?.defaultCategoryId ? { itemName: value, categoryId: match.defaultCategoryId } : { itemName: value })
  }
  // Entering what you paid also ticks the item off.
  const setItemPrice = (item: DraftItem, value: string) =>
    updateItem(item.key, value.trim() && !item.checked ? { price: value, checked: true } : { price: value })

  const itemOptions: ComboOption[] = useMemo(
    () =>
      (itemSuggestions ?? []).map((i) => ({
        value: i.name,
        label: i.name,
        hint: i.averagePrice != null ? `avg ${money(i.averagePrice)}` : undefined,
      })),
    [itemSuggestions],
  )
  const storeOptions: ComboOption[] = useMemo(
    () =>
      (storeSuggestions ?? [])
        .filter((s) => !stores.some((added) => normalize(added) === normalize(s.name)))
        .map((s) => ({ value: s.name, label: s.name })),
    [storeSuggestions, stores],
  )

  const averageByName = new Map((itemSuggestions ?? []).map((i) => [normalize(i.name), i.averagePrice]))
  const averageFor = (itemName: string) => averageByName.get(normalize(itemName)) ?? null

  // Fills each estimate with that item's average paid price. Items never bought
  // before have no average, so they keep whatever estimate (if any) was typed.
  const fillEstimates = () => {
    let filled = 0
    let untracked = 0
    const next = items.map((it) => {
      if (it.locked || !it.itemName.trim()) return it
      const average = averageFor(it.itemName)
      if (average == null) {
        untracked++
        return it
      }
      filled++
      return { ...it, estimate: average.toFixed(2) }
    })
    setItems(next)
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
    toast(
      'success',
      filled === 0
        ? 'None of these items have a price history yet.'
        : `Filled ${plural(filled, 'estimate')} from average prices.` +
            (untracked > 0 ? ` ${plural(untracked, 'item')} with no price history left as-is.` : ''),
    )
  }

  const previewRef = useRef<HTMLDivElement>(null)
  const categoryName = (categoryId: string) => categories?.find((c) => c.id === categoryId)?.name ?? 'Other'
  const namedItems = items.filter((it) => it.itemName.trim())
  const previewItems = namedItems.map((it) => ({
    itemName: it.itemName,
    categoryName: categoryName(it.categoryId),
    preferredStoreName: it.storeName,
    checked: it.checked,
    price: parseAmount(it.price),
  }))
  const hasPreview = previewItems.length > 0

  const costLines = namedItems.map((it) => ({
    storeName: it.storeName,
    estimate: parseAmount(it.estimate),
    price: parseAmount(it.price),
  }))
  const totals = summarize(costLines)
  const storeSubtotals = summarizeByStore(costLines, stores)
  const hasEstimate = totals.estimatedCount > 0
  const estimatedCostLabel = hasEstimate
    ? totals.estimatedCount < totals.lineCount
      ? `${money(totals.estimated)} (partial)`
      : money(totals.estimated)
    : null

  const parsedBudget = parseAmount(budget)
  // Whichever is higher: the plan, or what has actually been spent so far.
  const projected = Math.max(totals.estimated, totals.spent)
  const overBudget = parsedBudget != null && projected > parsedBudget
  const showSummary = totals.pricedCount > 0
  const hasLockedItems = items.some((it) => it.locked)

  const exportImage = async (format: 'png' | 'jpeg') => {
    if (!previewRef.current) return
    try {
      const dataUrl =
        format === 'png' ? await toPng(previewRef.current) : await toJpeg(previewRef.current, { quality: 0.95 })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${(name || 'grocery-trip').toLowerCase().replace(/\s+/g, '-')}.${format === 'jpeg' ? 'jpg' : 'png'}`
      a.click()
    } catch {
      toast('error', "Couldn't export this trip as an image.")
    }
  }

  const saveAs = (nextStatus: TripStatus, leave: boolean) => save.mutate({ status: nextStatus, leave })

  return (
    <div className="mx-auto max-w-[860px] px-5 pt-6 pb-25">
      <div className="mb-4.5 flex flex-wrap items-center gap-2.5">
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Back" onClick={() => navigate('/trips')}>
          ←
        </button>
        <h3 className="m-0">{persisted ? TITLE[status] : copyFromId ? 'Shop again' : 'New shopping list'}</h3>
        <span className={`tag text-[10px] ${status === 'done' ? 'tag-neutral' : 'tag-outline'}`}>{STATUS_TAG[status]}</span>
        <div className="ml-auto flex gap-1">
          {isEditing && (
            <button type="button" className="btn btn-ghost" onClick={() => navigate(`/trips/new?from=${tripId}`)}>
              Shop again
            </button>
          )}
          {isEditing && (
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--color-danger)' }} onClick={askDelete}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="card elev-sm gap-4">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="field">
            <label htmlFor="trip-name">Name</label>
            <input
              id="trip-name"
              className="input"
              placeholder="e.g. Weekly stock-up"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="trip-date">Date</label>
            <input id="trip-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="trip-budget">Budget (optional)</label>
            <input
              id="trip-budget"
              className="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 120.00"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label>Stores</label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {stores.map((s) => (
              <span key={s} className="tag tag-neutral flex items-center gap-1.5">
                {s}
                <button type="button" className="cursor-pointer border-none bg-transparent p-0 text-xs" onClick={() => removeStore(s)}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Combobox
              wrapperClassName="flex-1"
              aria-label="Store to add"
              placeholder="e.g. Costco"
              value={newStoreName}
              onChange={setNewStoreName}
              options={storeOptions}
              // Picking a suggestion adds it straight away.
              onSelect={(option) => addStore(option.value)}
              onKeyDown={(e) => e.key === 'Enter' && addStore()}
            />
            <button type="button" className="btn btn-secondary shrink-0 whitespace-nowrap" onClick={() => addStore()}>
              Add store
            </button>
          </div>
        </div>

        <div className="hr" />

        {/* Running totals. Pinned to the top of the screen while shopping, so the
            numbers stay in view as you work down a long list. */}
        <div
          className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md bg-surface text-sm ${
            status === 'shopping' ? 'sticky top-0 z-10 -mx-3 border-b border-divider px-3 py-2' : ''
          }`}
        >
          <span>
            <span className="text-text/60">Estimated </span>
            <strong>{estimatedCostLabel ?? '—'}</strong>
          </span>
          <span>
            <span className="text-text/60">Spent </span>
            <strong>{money(totals.spent)}</strong>
            {totals.lineCount > 0 && (
              <span className="text-text/50">
                {' '}
                · {namedItems.filter((it) => it.checked).length}/{totals.lineCount} picked up
              </span>
            )}
          </span>
          {parsedBudget != null && (
            <span className={overBudget ? 'text-danger' : ''}>
              <span className={overBudget ? '' : 'text-text/60'}>Budget </span>
              <strong>
                {overBudget ? `${money(projected - parsedBudget)} over` : `${money(parsedBudget - projected)} left`}
              </strong>
            </span>
          )}
          <button
            type="button"
            className="btn btn-secondary ml-auto px-2.5 py-1 text-xs"
            disabled={namedItems.length === 0}
            title="Set each item's estimate to the average price you've paid for it. Items with no price history are left as they are."
            onClick={fillEstimates}
          >
            Fill estimates from averages
          </button>
        </div>

        <TripItemList
          items={items}
          stores={stores}
          status={status}
          categories={categories}
          itemOptions={itemOptions}
          averageFor={averageFor}
          onUpdate={updateItem}
          onName={setItemName}
          onPrice={setItemPrice}
          onRemove={removeItem}
          onAdd={addItem}
        />
        {hasLockedItems && (
          <p className="m-0 text-xs text-text/60">Items marked with a lock were bought more than 7 days ago and can no longer be changed.</p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/trips')}>
            Cancel
          </button>
          {status === 'done' && (
            <button type="button" className="btn btn-secondary" disabled={save.isPending} onClick={() => saveAs('shopping', false)}>
              Reopen
            </button>
          )}
          <button
            type="button"
            className={status === 'done' ? 'btn btn-primary' : 'btn btn-secondary'}
            disabled={save.isPending}
            onClick={() => saveAs(status, true)}
          >
            {status === 'planned' ? 'Save list' : 'Save'}
          </button>
          {status === 'planned' && (
            <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => saveAs('shopping', false)}>
              Start shopping
            </button>
          )}
          {status === 'shopping' && (
            <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => saveAs('done', false)}>
              Finish trip
            </button>
          )}
        </div>
      </div>

      {showSummary && (
        <div className="card elev-sm mt-5.5 gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="m-0">{status === 'done' ? 'Trip summary' : 'So far'}</h4>
            {totals.savings != null && (
              <span className={`text-sm ${totals.savings < 0 ? 'text-danger' : 'text-accent'}`}>
                {totals.savings >= 0 ? 'Estimated savings ' : 'Over estimate by '}
                <strong>{money(Math.abs(totals.savings))}</strong>
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Store</th>
                  <th className="text-right">Estimated</th>
                  <th className="text-right">Spent</th>
                  <th className="text-right">Savings</th>
                </tr>
              </thead>
              <tbody>
                {storeSubtotals.map((s) => (
                  <tr key={s.storeName ?? ''}>
                    <td>
                      {s.storeName ?? <span className="text-text/60">Any store</span>}
                      <span className="text-text/50"> · {s.lineCount}</span>
                    </td>
                    <td className="text-right">{s.estimatedCount > 0 ? money(s.estimated) : '—'}</td>
                    <td className="text-right">{money(s.spent)}</td>
                    <td className="text-right">
                      <SavingsCell savings={s.savings} />
                    </td>
                  </tr>
                ))}
              </tbody>
              {storeSubtotals.length > 1 && (
                <tfoot>
                  <tr className="font-medium">
                    <td>Total</td>
                    <td className="text-right">{hasEstimate ? money(totals.estimated) : '—'}</td>
                    <td className="text-right">{money(totals.spent)}</td>
                    <td className="text-right">
                      <SavingsCell savings={totals.savings} />
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="m-0 text-xs text-text/50">Savings compare estimate and price on the items that have both.</p>
        </div>
      )}

      {hasPreview && (
        <div className="mt-5.5">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="m-0">Preview &amp; share</h4>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => exportImage('png')}>
                Export PNG
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => exportImage('jpeg')}>
                Export JPG
              </button>
            </div>
          </div>
          {/* The card is fixed-width for a consistent image export; on a phone it
              scrolls inside this box rather than widening the whole page. */}
          <div className="max-w-full overflow-x-auto pb-1">
            <ShareableListCard
              ref={previewRef}
              name={name || date}
              date={date}
              items={previewItems}
              estimatedCostLabel={estimatedCostLabel}
            />
          </div>
        </div>
      )}
    </div>
  )
}

const STATUS_TAG: Record<TripStatus, string> = { planned: 'Planned', shopping: 'Shopping', done: 'Done' }

function SavingsCell({ savings }: { savings: number | null }) {
  if (savings == null) return <span className="text-text/40">—</span>
  if (savings === 0) return <span>{money(0)}</span>
  return savings > 0 ? (
    <span className="text-accent">{money(savings)} under</span>
  ) : (
    <span className="text-danger">{money(-savings)} over</span>
  )
}

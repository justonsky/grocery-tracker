import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Trip, TripInput, TripItemInput, TripStatus } from '../api/types'
import { useToast } from '../components/ui/ToastProvider'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { SharePreview } from '../components/SharePreview'
import { Combobox, type ComboOption } from '../components/ui/Combobox'
import { TripItemList, type DraftItem } from '../components/TripItemList'
import { performOrQueue, newClientId } from '../offline/performOrQueue'
import { useUnsavedChangesGuard } from '../app/useUnsavedChangesGuard'
import { PlannedMeals } from '../components/recipes/PlannedMeals'
import { RecipePicker } from '../components/recipes/RecipePicker'
import { itemsToAdd, lineKeysToDrop, useRecipes } from '../recipes'
import type { Recipe } from '../api/types'
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

// A recipe's item as a trip line: estimated at its household average when there is one.
const recipeLine = (item: Recipe['items'][number], fallbackCategoryId: string, storeName: string | null): DraftItem => ({
  ...newItem(item.categoryId ?? fallbackCategoryId),
  itemName: item.itemName,
  storeName,
  estimate: item.averagePrice != null ? item.averagePrice.toFixed(2) : '',
})

// Keyed so that moving between trips — or from a trip to "shop again" from it —
// always starts a fresh editor instead of carrying one trip's id into another.
export function TripEditor({ profileId }: { profileId: string }) {
  const { tripId } = useParams()
  const [searchParams] = useSearchParams()
  return <TripEditorScreen key={tripId ?? `new:${searchParams.get('from') ?? ''}:${searchParams.get('recipe') ?? ''}`} profileId={profileId} />
}

function TripEditorScreen({ profileId }: { profileId: string }) {
  const { tripId } = useParams()
  const [searchParams] = useSearchParams()
  const copyFromId = tripId ? null : searchParams.get('from')
  // "Create shopping list" on a recipe arrives here: a new list with that meal planned.
  const recipeParam = tripId ? null : searchParams.get('recipe')
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
  // The trip's planned meals (recipe ids), in order.
  const [recipeIds, setRecipeIds] = useState<string[]>([])
  const [pickerFor, setPickerFor] = useState<{ storeName: string | null } | null>(null)
  const { data: recipes } = useRecipes()

  // What the form held right after it last loaded a server copy, to tell
  // whether anything has been edited since.
  const loadedSnapshotRef = useRef<string | null>(null)
  const copiedRef = useRef(false)
  const recipeAppliedRef = useRef(false)
  // The form's content (see `edits` below) as last loaded or saved: leaving with anything
  // different asks first. Null until the form has settled (a new list's first blank row).
  const baselineRef = useRef<string | null>(null)
  const snapshot = (draft: { name: string; date: string; budget: string; status: TripStatus; stores: string[]; items: DraftItem[]; recipeIds: string[] }) =>
    JSON.stringify({ ...draft, items: draft.items.map(({ key: _key, ...rest }) => rest) })

  const editsOf = (d: { name: string; date: string; budget: string; stores: string[]; items: DraftItem[]; recipeIds: string[] }) =>
    JSON.stringify({ name: d.name, date: d.date, budget: d.budget, stores: d.stores, recipeIds: d.recipeIds, items: d.items.map(({ key: _key, ...rest }) => rest) })

  const hydrate = (trip: Trip) => {
    const draft = {
      name: trip.name ?? '',
      date: trip.date,
      budget: amountText(trip.budget),
      status: trip.status,
      stores: trip.stores,
      recipeIds: trip.recipes?.map((r) => r.id) ?? [],
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
    setRecipeIds(draft.recipeIds)
    setItems(draft.items)
    loadedSnapshotRef.current = snapshot(draft)
    baselineRef.current = editsOf(draft)
  }

  useEffect(() => {
    if (existingTrip) {
      // A refetch (window focus, or the outbox syncing a queued save) must not
      // wipe edits made since the last load: only take the server's copy while
      // the form is still exactly what was last loaded.
      const edited =
        loadedSnapshotRef.current !== null &&
        snapshot({ name, date, budget, status, stores, items, recipeIds }) !== loadedSnapshotRef.current
      if (!edited) hydrate(existingTrip)
    } else if (sourceTrip && !copiedRef.current) {
      // Shopping again from a past trip: same name, stores and items, as a
      // fresh plan — nothing ticked off, priced or estimated yet. Once only: a
      // later refetch of the source must not wipe what's been typed since.
      copiedRef.current = true
      setName(sourceTrip.name ?? '')
      setStores(sourceTrip.stores)
      setRecipeIds(sourceTrip.recipes?.map((r) => r.id) ?? [])
      setItems(
        sourceTrip.items.map((it) => ({
          ...newItem(it.categoryId),
          itemName: it.itemName,
          storeName: it.storeName,
        })),
      )
    } else if (recipeParam && !recipeAppliedRef.current && recipes && categories) {
      // Once: the recipe's items (at their household average price) and the meal itself.
      recipeAppliedRef.current = true
      const recipe = recipes.find((r) => r.id === recipeParam)
      if (recipe) {
        setName(recipe.name)
        setRecipeIds([recipe.id])
        setItems(recipe.items.map((i) => recipeLine(i, categories[0]?.id ?? '', null)))
      } else {
        setItems([newItem(categories[0]?.id ?? '')])
      }
    } else if (categories && items.length === 0 && !isEditing && (!copyFromId || sourceFailed) && !recipeParam) {
      setItems([newItem(categories[0]?.id ?? '')])
    }
  }, [existingTrip, sourceTrip, sourceFailed, categories, isEditing, copyFromId, recipes, recipeParam]) // eslint-disable-line react-hooks/exhaustive-deps

  const defaultCategoryId = categories?.[0]?.id ?? ''

  const save = useMutation({
    // See ProfilePicker's create — without this, useMutation pauses entirely while
    // offline instead of ever reaching performOrQueue's own fallback logic.
    networkMode: 'always',
    mutationFn: async ({ status: nextStatus }: { status: TripStatus; leave: boolean; edits: string }) => {
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
        recipeIds,
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
    onSuccess: (outcome, { status: nextStatus, leave, edits }) => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', profileId] })
      queryClient.invalidateQueries({ queryKey: ['trips', profileId] })
      queryClient.invalidateQueries({ queryKey: ['items'] })
      queryClient.invalidateQueries({ queryKey: ['stores'] })
      queryClient.invalidateQueries({ queryKey: ['item-history'] })
      setPersisted(true)
      setStatus(nextStatus)
      // What was just sent (or queued) is saved: leaving now loses nothing.
      if (editsRef.current === edits) baselineRef.current = edits

      const queuedMessage = "Saved on this device — will sync when you're back online."
      if (leave) {
        toast('success', outcome.sent ? SAVED[nextStatus] : queuedMessage)
        navigate('/trips')
        return
      }

      // Staying on the trip (a status change): take the server's copy so new
      // lines get their ids and lock dates. A new trip moves to its own URL;
      // the cache entry set here is what the remounted editor loads from.
      // Only while the form is still what was sent: anything changed while the
      // request was in flight is kept (and goes out with the next save).
      if (outcome.sent) {
        queryClient.setQueryData(['trip', profileId, id], outcome.result)
        if (editsRef.current === edits) {
          hydrate(outcome.result)
          if (!isEditing) navigate(`/trips/${id}`, { replace: true })
        }
      }
      toast('success', outcome.sent ? SAVED[nextStatus] : queuedMessage)
    },
    onError: () => toast('error', "Couldn't save this trip."),
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
      baselineRef.current = editsRef.current // deleted: nothing left to lose
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
    setItems((its) =>
      its.map((it) => (it.storeName && normalize(it.storeName) === normalize(storeName) && !it.locked ? { ...it, storeName: null } : it)),
    )
  }

  const updateItem = (key: string, patch: Partial<DraftItem>) => {
    // Ticking something off or paying for it means the shop has started.
    if ((patch.checked || patch.price) && status === 'planned') setStatus('shopping')
    setItems((its) => its.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }
  const planRecipe = (recipe: Recipe, storeName: string | null) => {
    const added = itemsToAdd(recipe, items.filter((it) => it.itemName.trim()))
    setItems((its) => {
      // The blank starter row makes way for the first real items.
      const kept = its.filter((it) => it.itemName.trim() || it.price || it.checked)
      return [...kept, ...added.map((i) => recipeLine(i, defaultCategoryId, storeName))]
    })
    setRecipeIds((ids) => (ids.includes(recipe.id) ? ids : [...ids, recipe.id]))
    toast('success', added.length === 0 ? `${recipe.name}: everything was already on the list.` : `Added ${added.length} ${added.length === 1 ? 'item' : 'items'} for ${recipe.name}.`)
  }
  // Taking a meal off the plan also takes its unbought items — except any another planned
  // meal still needs. Ticked or priced lines are kept: they've been bought.
  const unplanRecipe = (recipeId: string) => {
    const removed = recipes?.find((r) => r.id === recipeId)
    const remaining = recipeIds.filter((id) => id !== recipeId).map((id) => recipes?.find((r) => r.id === id)).filter((r): r is Recipe => !!r)
    const dropped = lineKeysToDrop(removed, remaining, items)
    setItems((its) => {
      const left = its.filter((it) => !dropped.has(it))
      return left.length > 0 || !defaultCategoryId ? left : [newItem(defaultCategoryId)]
    })
    setRecipeIds((ids) => ids.filter((id) => id !== recipeId))
    toast('success', `Removed ${removed?.name ?? 'the meal'}${dropped.size > 0 ? ` and ${dropped.size} unbought ${dropped.size === 1 ? 'item' : 'items'}` : ''}.`)
  }
  const removeItem = (key: string) => setItems((its) => its.filter((it) => it.key !== key))
  const addItem = (storeName: string | null = null) => setItems((its) => [...its, { ...newItem(defaultCategoryId), storeName }])

  // Picking a known item carries over the category that item last used.
  const setItemName = (key: string, value: string) => {
    const match = itemSuggestions?.find((i) => normalize(i.name) === normalize(value))
    updateItem(key, match?.defaultCategoryId ? { itemName: value, categoryId: match.defaultCategoryId } : { itemName: value })
  }
  // Entering what you paid never ticks the item: picking it up is the checkbox's
  // job, and ticking it here would also whisk the line out of the "to find" list
  // while its price is still being typed.
  const setItemPrice = (item: DraftItem, value: string) => updateItem(item.key, { price: value })

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

  // Planned meals as shown: the recipe's own data when it's loaded, else what the trip remembered.
  const plannedMeals = recipeIds.map((id) => {
    const recipe = recipes?.find((r) => r.id === id)
    const remembered = (existingTrip?.recipes ?? sourceTrip?.recipes)?.find((r) => r.id === id)
    return recipe
      ? { id, name: recipe.name, photoVersion: recipe.photoVersion, itemCount: recipe.items.length }
      : { id, name: remembered?.name ?? 'Recipe', photoVersion: remembered?.photoVersion ?? 0, itemCount: remembered?.itemCount ?? 0 }
  })

  const categoryName = (categoryId: string) => categories?.find((c) => c.id === categoryId)?.name ?? 'Other'
  const namedItems = items.filter((it) => it.itemName.trim())
  const previewItems = namedItems.map((it) => ({
    itemName: it.itemName,
    categoryName: categoryName(it.categoryId),
    storeName: it.storeName,
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
  const pickedCount = totals.lineCount > 0 ? namedItems.filter((it) => it.checked).length : null

  // The form's content minus status, to tell whether it changed during a save.
  const edits = editsOf({ name, date, budget, stores, items, recipeIds })
  const editsRef = useRef(edits)
  editsRef.current = edits
  // A new list has no server copy to hydrate from: its baseline is the blank (or copied) form once it appears.
  useEffect(() => {
    if (baselineRef.current === null && !isEditing && items.length > 0) baselineRef.current = edits
  }, [edits, isEditing, items.length])
  useUnsavedChangesGuard(() => baselineRef.current !== null && editsRef.current !== baselineRef.current)
  const saveAs = (nextStatus: TripStatus, leave: boolean) => save.mutate({ status: nextStatus, leave, edits })

  return (
    <div className="mx-auto max-w-[860px] px-4 pt-5 pb-25 sm:px-5 sm:pt-6">
      <div className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <button
          type="button"
          className="btn btn-ghost btn-icon -ml-2 text-text"
          aria-label="Back"
          onClick={() => navigate('/trips')}
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="min-w-0 flex-1 basis-40">
          <h3 className="m-0 truncate">{persisted ? TITLE[status] : copyFromId ? 'Shop again' : 'New shopping list'}</h3>
          {pickedCount != null && (
            <div className="text-xs text-text/70 tabular-nums">
              {pickedCount} of {totals.lineCount} picked up
            </div>
          )}
        </div>
        <span className={`tag text-[11px] ${STATUS_TAG_CLASS[status]}`}>{STATUS_TAG[status]}</span>
        {isEditing && (
          <div className="flex w-full justify-end gap-1.5 sm:w-auto">
            <button type="button" className="btn btn-secondary btn-sm max-sm:min-h-11" onClick={() => navigate(`/trips/new?from=${tripId}`)}>
              Shop again
            </button>
            <button type="button" className="btn btn-ghost btn-sm text-danger hover:bg-danger-bg max-sm:min-h-11" onClick={askDelete}>
              Delete
            </button>
          </div>
        )}
      </div>

      <div className="card gap-4 border border-divider p-4 elev-sm sm:p-5">
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
            <input
              id="trip-date"
              className="input"
              type="date"
              value={date}
              disabled={hasLockedItems}
              title={hasLockedItems ? 'Fixed once prices on this trip are locked — price history is dated by the trip' : undefined}
              onChange={(e) => setDate(e.target.value)}
            />
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
              <span key={s} className="tag tag-neutral flex items-center gap-1 py-0.5 pr-0.5 pl-3 text-[13px]">
                {s}
                <button
                  type="button"
                  title={`Remove ${s}`}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 text-base leading-none text-text/70 hover:bg-text/10 hover:text-text"
                  onClick={() => removeStore(s)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
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
      </div>

      <div className="mt-4 grid gap-3.5">
        {/* Running totals. Pinned to the top of the screen while shopping, so the
            numbers stay in view as you work down a long list. */}
        <div
          className={`grid gap-2.5 ${
            status === 'shopping' ? 'sticky top-0 z-10 -mx-4 border-b border-divider bg-bg px-4 py-2.5 sm:-mx-5 sm:px-5' : ''
          }`}
        >
          <div className={`grid gap-2 ${parsedBudget != null ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <div className="min-w-0 rounded-md border border-divider bg-surface px-3 py-2">
              <div className="text-[11px] font-semibold text-text/70">Estimated</div>
              <div className="truncate font-heading text-base font-bold tabular-nums sm:text-lg">{estimatedCostLabel ?? '—'}</div>
            </div>
            <div className="min-w-0 rounded-md border border-divider bg-surface px-3 py-2">
              <div className="text-[11px] font-semibold text-text/70">Spent</div>
              <div className="truncate font-heading text-base font-bold tabular-nums sm:text-lg">{money(totals.spent)}</div>
            </div>
            {parsedBudget != null && (
              <div className={`min-w-0 rounded-md border px-3 py-2 ${overBudget ? 'border-danger/30 bg-danger-bg text-danger' : 'border-divider bg-surface'}`}>
                <div className={`text-[11px] font-semibold ${overBudget ? '' : 'text-text/70'}`}>Budget</div>
                <div className="truncate font-heading text-base font-bold tabular-nums sm:text-lg">
                  {overBudget ? `${money(projected - parsedBudget)} over` : `${money(parsedBudget - projected)} left`}
                </div>
              </div>
            )}
          </div>
          {pickedCount != null && (
            <div className="flex items-center gap-3">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-chip"
                role="progressbar"
                aria-label="Trip progress"
                aria-valuemin={0}
                aria-valuemax={totals.lineCount}
                aria-valuenow={pickedCount}
              >
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(pickedCount / totals.lineCount) * 100}%` }} />
              </div>
              <span className="shrink-0 text-xs text-text/70 tabular-nums">
                {pickedCount}/{totals.lineCount} picked up
              </span>
              {totals.savings != null && totals.savings > 0 && (
                <span className={`tag shrink-0 py-0.5 text-[11px] tabular-nums ${status === 'done' ? 'tag-highlight' : 'tag-accent'}`}>
                  Saved {money(totals.savings)}
                </span>
              )}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-secondary btn-sm max-sm:min-h-11"
              disabled={namedItems.length === 0}
              title="Set each item's estimate to the average price you've paid for it. Items with no price history are left as they are."
              onClick={fillEstimates}
            >
              Fill estimates from averages
            </button>
          </div>
        </div>

        <PlannedMeals meals={plannedMeals} onRemove={unplanRecipe} />

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
          onAddRecipe={(storeName) => setPickerFor({ storeName })}
        />
        {pickerFor && (
          <RecipePicker
            recipes={recipes}
            planned={new Set(recipeIds)}
            storeName={pickerFor.storeName}
            onPick={(recipe) => planRecipe(recipe, pickerFor.storeName)}
            onClose={() => setPickerFor(null)}
          />
        )}
        {hasLockedItems && (
          <p className="m-0 flex items-center gap-1.5 text-xs text-text/70">Items marked with a lock were bought more than 7 days ago and can no longer be changed.</p>
        )}

        {/* On a phone this is a bar docked above the bottom tab bar (nothing hides
            behind it: the page pads for it); from lg up it is a plain row. */}
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex gap-2 border-t border-divider bg-surface px-3 py-2.5 group-has-[[data-sync-strip]]:bottom-[calc(7.25rem+env(safe-area-inset-bottom))] lg:static lg:z-auto lg:flex-wrap lg:justify-end lg:border-0 lg:bg-transparent lg:p-0">
          <button type="button" className="btn btn-ghost max-lg:min-h-12 max-lg:px-3 text-text" onClick={() => navigate('/trips')}>
            Cancel
          </button>
          {status === 'done' && (
            <button type="button" className="btn btn-secondary max-lg:min-h-12" disabled={save.isPending} onClick={() => saveAs('shopping', false)}>
              Reopen
            </button>
          )}
          <button
            type="button"
            className={`btn max-lg:min-h-12 ${status === 'done' ? 'btn-primary max-lg:flex-1' : 'btn-secondary'}`}
            disabled={save.isPending}
            onClick={() => saveAs(status, true)}
          >
            {status === 'planned' ? 'Save list' : 'Save'}
          </button>
          {status === 'planned' && (
            <button type="button" className="btn btn-highlight max-lg:min-h-12 max-lg:flex-1" disabled={save.isPending} onClick={() => saveAs('shopping', false)}>
              Start shopping
            </button>
          )}
          {status === 'shopping' && (
            <button type="button" className="btn btn-highlight max-lg:min-h-12 max-lg:flex-1" disabled={save.isPending} onClick={() => saveAs('done', false)}>
              Finish trip
            </button>
          )}
        </div>
      </div>

      {showSummary && (
        <div className="card mt-5.5 gap-3 border border-divider elev-sm sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="m-0 text-lg">{status === 'done' ? 'Trip summary' : 'So far'}</h4>
            {totals.savings != null && (
              <span
                className={`tag text-[13px] font-semibold tabular-nums ${
                  totals.savings < 0 ? 'bg-danger-bg text-danger' : status === 'done' && totals.savings > 0 ? 'tag-highlight' : 'tag-accent'
                }`}
              >
                {totals.savings >= 0 ? 'Estimated savings ' : 'Over estimate by '}
                <strong className="ml-1">{money(Math.abs(totals.savings))}</strong>
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
          <p className="m-0 text-xs text-text/60">Savings compare estimate and price on the items that have both.</p>
        </div>
      )}

      {hasPreview && (
        <SharePreview name={name} date={date} items={previewItems} stores={stores} estimatedCostLabel={estimatedCostLabel} />
      )}
    </div>
  )
}

const STATUS_TAG: Record<TripStatus, string> = { planned: 'Planned', shopping: 'Shopping', done: 'Done' }
const STATUS_TAG_CLASS: Record<TripStatus, string> = { planned: 'tag-neutral', shopping: 'tag-outline', done: 'tag-accent' }

function SavingsCell({ savings }: { savings: number | null }) {
  if (savings == null) return <span className="text-text/50">—</span>
  if (savings === 0) return <span>{money(0)}</span>
  return savings > 0 ? (
    <span className="font-semibold text-accent">{money(savings)} under</span>
  ) : (
    <span className="text-danger">{money(-savings)} over</span>
  )
}

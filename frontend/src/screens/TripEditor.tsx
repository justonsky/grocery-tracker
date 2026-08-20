import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toJpeg, toPng } from 'html-to-image'
import { api } from '../api/client'
import type { TripInput, TripItemInput } from '../api/types'
import { useToast } from '../components/ui/ToastProvider'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { ShareableListCard } from '../components/ShareableListCard'
import { performOrQueue, newClientId } from '../offline/performOrQueue'

const todayIso = () => new Date().toISOString().slice(0, 10)
const money = (n: number) => `$${n.toFixed(2)}`

// A row is both a planned item and a bought one: tick it off and fill the price
// as you shop. Price stays a string while editing so the field can be left blank.
interface DraftItem extends Omit<TripItemInput, 'price'> {
  key: string
  price: string
}
const newItem = (categoryId: string): DraftItem => ({
  key: Math.random().toString(36).slice(2, 9),
  itemName: '',
  categoryId,
  storeName: null,
  checked: false,
  price: '',
})

export function TripEditor({ profileId }: { profileId: string }) {
  const { tripId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const isEditing = Boolean(tripId)

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories.list })
  const { data: existingTrip } = useQuery({
    queryKey: ['trip', profileId, tripId],
    queryFn: () => api.trips(profileId).get(tripId!),
    enabled: isEditing,
  })
  // Full item/store lists back native <datalist> autocomplete below — small
  // enough per profile that fetching once beats debouncing per keystroke.
  const { data: itemSuggestions } = useQuery({ queryKey: ['items', profileId], queryFn: () => api.items(profileId).search() })
  const { data: storeSuggestions } = useQuery({ queryKey: ['stores', profileId], queryFn: () => api.stores(profileId).search() })

  const [name, setName] = useState('')
  const [date, setDate] = useState(todayIso())
  const [budget, setBudget] = useState('')
  const [stores, setStores] = useState<string[]>([])
  const [newStoreName, setNewStoreName] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])

  useEffect(() => {
    if (existingTrip) {
      setName(existingTrip.name ?? '')
      setDate(existingTrip.date)
      setBudget(existingTrip.budget != null ? String(existingTrip.budget) : '')
      setStores(existingTrip.stores)
      setItems(
        existingTrip.items.map((it) => ({
          key: it.id,
          itemName: it.itemName,
          categoryId: it.categoryId,
          storeName: it.storeName,
          checked: it.checked,
          price: it.price != null ? String(it.price) : '',
        })),
      )
    } else if (categories && items.length === 0 && !isEditing) {
      setItems([newItem(categories[0]?.id ?? '')])
    }
  }, [existingTrip, categories, isEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  const defaultCategoryId = categories?.[0]?.id ?? ''
  const parsePrice = (value: string) => {
    const n = Number.parseFloat(value)
    return value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null
  }

  const save = useMutation({
    // See ProfilePicker's create — without this, useMutation pauses entirely while
    // offline instead of ever reaching performOrQueue's own fallback logic.
    networkMode: 'always',
    mutationFn: async () => {
      const cleanItems: TripItemInput[] = items
        .filter((r) => r.itemName.trim())
        .map(({ key: _key, price, ...rest }) => ({ ...rest, price: parsePrice(price) }))
      const input: TripInput = {
        name: name.trim() || null,
        date,
        budget: parsePrice(budget),
        stores,
        items: cleanItems,
      }
      const id = isEditing ? tripId! : newClientId()

      return performOrQueue(() => api.trips(profileId).upsert(id, input), {
        entity: 'trip',
        action: 'put',
        entityId: id,
        profileId,
        isCreate: !isEditing,
        payload: input,
        // Harmless even when these categories are already synced — only
        // blocks the trip if a matching category op is itself failed/blocked.
        dependsOn: Array.from(new Set(cleanItems.map((i) => i.categoryId))),
        label: `Trip "${input.name || input.date}"`,
      })
    },
    onSuccess: (outcome) => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', profileId] })
      queryClient.invalidateQueries({ queryKey: ['trips', profileId] })
      queryClient.invalidateQueries({ queryKey: ['items', profileId] })
      queryClient.invalidateQueries({ queryKey: ['stores', profileId] })
      toast(
        'success',
        outcome.sent
          ? isEditing
            ? 'Trip updated.'
            : 'Trip saved.'
          : "Saved on this device — will sync when you're back online.",
      )
      navigate('/trips')
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
      navigate('/trips')
    },
    onError: () => toast('error', "Couldn't delete this trip."),
  })

  const askDelete = async () => {
    const ok = await confirm({ title: 'Delete this trip?', body: 'This permanently removes the trip and its items.' })
    if (ok) del.mutate()
  }

  const addStore = () => {
    const trimmed = newStoreName.trim()
    if (!trimmed || stores.some((s) => s.toLowerCase() === trimmed.toLowerCase())) return
    setStores((s) => [...s, trimmed])
    setNewStoreName('')
  }
  const removeStore = (storeName: string) => {
    setStores((s) => s.filter((x) => x !== storeName))
    setItems((its) => its.map((it) => (it.storeName === storeName ? { ...it, storeName: null } : it)))
  }

  const updateItem = (key: string, patch: Partial<DraftItem>) =>
    setItems((its) => its.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  const removeItem = (key: string) => setItems((its) => its.filter((it) => it.key !== key))
  const addItem = () => setItems((its) => [...its, newItem(defaultCategoryId)])

  // Picking a datalist suggestion carries over the category that item last used.
  const setItemName = (key: string, value: string) => {
    const match = itemSuggestions?.find((i) => i.name.toLowerCase() === value.toLowerCase())
    updateItem(key, match?.defaultCategoryId ? { itemName: value, categoryId: match.defaultCategoryId } : { itemName: value })
  }

  const previewRef = useRef<HTMLDivElement>(null)
  const categoryName = (id: string) => categories?.find((c) => c.id === id)?.name ?? 'Other'
  const namedItems = items.filter((it) => it.itemName.trim())
  const previewItems = namedItems.map((it) => ({
    itemName: it.itemName,
    categoryName: categoryName(it.categoryId),
    preferredStoreName: it.storeName,
    checked: it.checked,
    price: parsePrice(it.price),
  }))
  const hasPreview = previewItems.length > 0

  // Estimated cost prefers what this trip actually recorded for an item, and falls
  // back to what that item cost last time for anything not yet priced.
  const lastPriceByName = new Map(
    (itemSuggestions ?? []).map((i) => [i.name.trim().toLowerCase(), i.lastPrice]),
  )
  let estimatedCost = 0
  let pricedCount = 0
  for (const it of namedItems) {
    const own = parsePrice(it.price)
    const price = own ?? lastPriceByName.get(it.itemName.trim().toLowerCase())
    if (typeof price === 'number' && price > 0) {
      estimatedCost += price
      pricedCount++
    }
  }
  const hasEstimate = pricedCount > 0
  const estimatedCostLabel = hasEstimate
    ? pricedCount < namedItems.length
      ? `${money(estimatedCost)} (partial)`
      : money(estimatedCost)
    : 'No price history yet'

  const parsedBudget = Number.parseFloat(budget)
  const hasBudget = budget.trim() !== '' && Number.isFinite(parsedBudget)
  const overBudget = hasEstimate && hasBudget && estimatedCost > parsedBudget

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

  return (
    <div className="mx-auto max-w-[760px] px-5 pt-6 pb-25">
      <div className="mb-4.5 flex items-center gap-2.5">
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Back" onClick={() => navigate('/trips')}>
          ←
        </button>
        <h3 className="m-0">{isEditing ? 'Edit trip' : 'New trip'}</h3>
        {isEditing && (
          <button type="button" className="btn btn-ghost ml-auto" style={{ color: 'var(--color-danger)' }} onClick={askDelete}>
            Delete trip
          </button>
        )}
      </div>

      <div className="card elev-sm gap-4">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="field">
            <label htmlFor="trip-name">Trip name</label>
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
            <input
              className="input"
              list="dl-stores"
              placeholder="e.g. Costco"
              value={newStoreName}
              onChange={(e) => setNewStoreName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addStore()}
            />
            <button type="button" className="btn btn-secondary" onClick={addStore}>
              Add store
            </button>
          </div>
        </div>
        <datalist id="dl-stores">
          {storeSuggestions?.map((s) => <option key={s.id} value={s.name} />)}
        </datalist>
        <datalist id="dl-items">
          {itemSuggestions?.map((i) => <option key={i.id} value={i.name} />)}
        </datalist>

        <div className="hr" />

        <div className="grid gap-2.5">
          {items.map((item) => (
            <div key={item.key} className="grid grid-cols-[auto_1.3fr_0.9fr_0.7fr_0.9fr_auto] items-center gap-2">
              <input
                type="checkbox"
                title="Picked up"
                aria-label={`Picked up ${item.itemName || 'item'}`}
                checked={item.checked}
                onChange={(e) => updateItem(item.key, { checked: e.target.checked })}
                className="h-4.5 w-4.5 accent-accent"
              />
              <input
                className="input"
                list="dl-items"
                placeholder="Item name"
                value={item.itemName}
                onChange={(e) => setItemName(item.key, e.target.value)}
              />
              <select className="input" value={item.categoryId} onChange={(e) => updateItem(item.key, { categoryId: e.target.value })}>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                aria-label="Price"
                value={item.price}
                onChange={(e) => updateItem(item.key, { price: e.target.value })}
              />
              <select
                className="input"
                aria-label="Store"
                value={item.storeName ?? ''}
                onChange={(e) => updateItem(item.key, { storeName: e.target.value || null })}
              >
                <option value="">Any store</option>
                {stores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove item" onClick={() => removeItem(item.key)}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost justify-self-start" onClick={addItem}>
            + Add item
          </button>
          <div className="flex items-center gap-1.5 justify-self-start">
            <span className="card-meta">
              Estimated cost: <strong className="text-text">{estimatedCostLabel}</strong>
            </span>
            {overBudget && (
              <span
                className="inline-flex text-accent-300"
                title={`Estimated cost exceeds your budget of ${money(parsedBudget)}`}
                role="img"
                aria-label={`Estimated cost exceeds your budget of ${money(parsedBudget)}`}
              >
                <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor">
                  <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,32a12,12,0,1,1-12-12A12,12,0,0,1,140,168Z" />
                </svg>
              </span>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/trips')}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            Save trip
          </button>
        </div>
      </div>

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
          <ShareableListCard
            ref={previewRef}
            name={name || date}
            date={date}
            items={previewItems}
            estimatedCostLabel={hasEstimate ? estimatedCostLabel : null}
          />
        </div>
      )}
    </div>
  )
}

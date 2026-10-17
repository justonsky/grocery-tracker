import { useMemo, useState } from 'react'
import { useUnsavedChangesGuard } from '../app/useUnsavedChangesGuard'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { ProblemTypes } from '../api/problemTypes'
import type { HouseholdTrip, ItemAlias, ItemLine, QuantityUnit, SaveItemLineRequest } from '../api/types'
import { QuantityField, quantityText } from '../components/QuantityField'
import { Combobox, type ComboOption } from '../components/ui/Combobox'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { useToast } from '../components/ui/ToastProvider'
import { parseQuantity, perUnit, validQuantity } from '../trips/quantity'

const money = (n: number) => `$${n.toFixed(2)}`
const normalize = (s: string) => s.trim().toLowerCase()
const parseAmount = (value: string) => {
  const n = Number.parseFloat(value)
  return value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null
}
const tripLabel = (t: { date: string; name: string | null; stores?: string[]; profileName: string }) =>
  `${t.date} · ${t.name || t.stores?.join(', ') || 'Trip'} · ${t.profileName}`

// Anything an Items-portal edit can change: the catalogue, price history and
// averages, trips (lines move between them), and every dashboard grid.
export function invalidateItemData(queryClient: QueryClient) {
  for (const key of ['catalog', 'item-lines', 'items', 'item-history', 'trips', 'trip', 'household-trips', 'dashboard', 'tracked-items']) {
    void queryClient.invalidateQueries({ queryKey: [key] })
  }
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError && error.problemType === ProblemTypes.ItemNameConflict
    ? 'Another item already has that name. To combine them, use "Merge into another item" below.'
    : error instanceof ApiError && error.message
      ? error.message
      : fallback

export function ItemEditor({
  itemId,
  online,
  onClose,
  onSelect,
}: {
  itemId: string
  online: boolean
  onClose: () => void
  onSelect: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()

  const { data: catalogue } = useQuery({ queryKey: ['catalog', ''], queryFn: () => api.catalog.list() })
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories.list })
  const { data: lines, isLoading: linesLoading } = useQuery({ queryKey: ['item-lines', itemId], queryFn: () => api.catalog.lines(itemId) })
  const { data: trips } = useQuery({ queryKey: ['household-trips'], queryFn: api.catalog.trips })
  const { data: stores } = useQuery({ queryKey: ['stores'], queryFn: () => api.stores.search() })

  const item = catalogue?.find((i) => i.id === itemId)
  const storeOptions: ComboOption[] = useMemo(() => (stores ?? []).map((s) => ({ value: s.name, label: s.name })), [stores])

  // Newest first, a page at a time — a staple can have years of records.
  const [linesShown, setLinesShown] = useState(10)
  const [name, setName] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const nameValue = name ?? item?.name ?? ''
  const categoryValue = categoryId ?? item?.defaultCategoryId ?? ''
  const detailsDirty = !!item && (nameValue.trim() !== item.name || categoryValue !== (item.defaultCategoryId ?? ''))

  useUnsavedChangesGuard(detailsDirty)

  const saveDetails = useMutation({
    mutationFn: () => api.catalog.update(itemId, { name: nameValue.trim(), defaultCategoryId: categoryValue || null }),
    onSuccess: () => {
      invalidateItemData(queryClient)
      setName(null)
      setCategoryId(null)
      toast('success', 'Item saved.')
    },
    onError: (error) => toast('error', errorMessage(error, "Couldn't save this item.")),
  })

  const deleteItem = useMutation({
    mutationFn: () => api.catalog.delete(itemId),
    onSuccess: () => {
      invalidateItemData(queryClient)
      toast('success', 'Item deleted.')
      onClose()
    },
    onError: () => toast('error', "Couldn't delete this item."),
  })

  const askDelete = async () => {
    const count = item?.lineCount ?? 0
    const ok = await confirm({
      title: `Delete "${item?.name}"?`,
      body:
        count > 0
          ? `This also removes it from ${count} ${count === 1 ? 'trip' : 'trips'}, along with its price history. To keep the history under another name, merge it instead.`
          : 'It has no purchase records.',
      confirmLabel: 'Delete item',
    })
    if (ok) deleteItem.mutate()
  }

  if (!catalogue) return <div className="skel h-60" />
  if (!item) {
    return (
      <div className="card elev-sm gap-2 text-sm">
        <p className="m-0">This item no longer exists — it may have been merged or deleted.</p>
        <button type="button" className="btn btn-secondary self-start" onClick={onClose}>
          Back to items
        </button>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost btn-icon lg:hidden" aria-label="Back to items" onClick={onClose}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h3 className="m-0 min-w-0 text-2xl break-words">{item.name}</h3>
        <Link to={`/items/${itemId}`} className="btn btn-secondary ml-auto">
          Price history
        </Link>
      </div>

      <section className="card elev-md gap-3" aria-labelledby="item-details">
        <h4 id="item-details" className="m-0 text-lg">
          Details
        </h4>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div className="field">
            <label htmlFor="item-name">Name</label>
            <input id="item-name" className="input" value={nameValue} disabled={!online} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="item-category">Default category</label>
            <select id="item-category" className="input" value={categoryValue} disabled={!online} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No default category</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-text/60">
            {item.purchaseCount} {item.purchaseCount === 1 ? 'purchase' : 'purchases'}
            {item.averagePrice != null && ` · average ${money(item.averagePrice)}${perUnit(item.priceUnit)}`}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!online || !detailsDirty || !nameValue.trim() || saveDetails.isPending}
            onClick={() => saveDetails.mutate()}
          >
            Save details
          </button>
        </div>
      </section>

      <section className="card elev-md gap-3" aria-labelledby="item-records">
        <div>
          <h4 id="item-records" className="m-0 text-lg">
            Purchase records
          </h4>
          <p className="m-0 mt-0.5 text-xs text-text/60">
            Every trip this item is on. Change the price, the store, or which trip it belongs to.
          </p>
        </div>
        {linesLoading && <div className="skel h-24" />}
        {lines?.length === 0 && <p className="m-0 text-sm text-text/60">Not on any trip yet.</p>}
        <div className="grid gap-2">
          {lines?.slice(0, linesShown).map((line) => (
            <LineRow key={line.id} itemId={itemId} line={line} trips={trips ?? []} storeOptions={storeOptions} online={online} />
          ))}
        </div>
        {lines && lines.length > linesShown && (
          <button type="button" className="btn btn-secondary self-start" onClick={() => setLinesShown((n) => n + 10)}>
            Show {Math.min(10, lines.length - linesShown)} more of {lines.length - linesShown}
          </button>
        )}
        <AddLine itemId={itemId} trips={trips ?? []} storeOptions={storeOptions} online={online} />
      </section>

      <ReceiptNames itemId={itemId} online={online} />

      <MergeSection
        itemId={itemId}
        itemName={item.name}
        lines={lines ?? []}
        catalogue={catalogue.filter((i) => i.id !== itemId)}
        online={online}
        onMerged={(targetId, sourceDeleted) => (sourceDeleted ? onSelect(targetId) : undefined)}
      />

      <section className="card elev-sm gap-2 border border-danger/25" aria-labelledby="item-delete">
        <h4 id="item-delete" className="m-0 text-lg">
          Delete item
        </h4>
        <p className="m-0 text-xs text-text/60">Removes the item and every purchase record above. This can't be undone.</p>
        <button
          type="button"
          className="btn btn-danger self-start"
          disabled={!online || deleteItem.isPending}
          onClick={askDelete}
        >
          Delete "{item.name}"
        </button>
      </section>
    </div>
  )
}

// A searchable trip picker: focus shows the most recent trips, typing narrows by
// date, name, store or who shopped. 364 trips don't fit a <select>.
function TripSelect({
  value,
  trips,
  onChange,
  disabled,
  current,
}: {
  value: string
  trips: HouseholdTrip[]
  onChange: (id: string) => void
  disabled: boolean
  current?: ItemLine
}) {
  // The household trip list may still be loading; keep the line's own trip known meanwhile.
  const all = useMemo(
    () =>
      current && !trips.some((t) => t.id === current.tripId)
        ? [{ id: current.tripId, date: current.tripDate, name: current.tripName, profileName: current.profileName, stores: [] }, ...trips]
        : trips,
    [trips, current],
  )
  const options: ComboOption[] = useMemo(() => all.map((t) => ({ value: t.id, label: tripLabel(t) })), [all])
  const selectedLabel = options.find((o) => o.value === value)?.label ?? ''
  const [text, setText] = useState<string | null>(null)

  return (
    <Combobox
      aria-label="Trip"
      placeholder="Search trips by date, name or store"
      value={text ?? selectedLabel}
      options={options}
      minChars={0}
      disabled={disabled}
      onFocus={(e) => {
        setText('')
        e.currentTarget.select()
      }}
      onChange={setText}
      onSelect={(option) => {
        onChange(option.value)
        setText(null)
      }}
      // Typing without picking leaves the trip as it was.
      onBlur={() => setText(null)}
    />
  )
}

function LineRow({
  itemId,
  line,
  trips,
  storeOptions,
  online,
}: {
  itemId: string
  line: ItemLine
  trips: HouseholdTrip[]
  storeOptions: ComboOption[]
  online: boolean
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [tripId, setTripId] = useState(line.tripId)
  const [store, setStore] = useState(line.storeName ?? '')
  const [price, setPrice] = useState(line.price != null ? String(line.price) : '')
  const [quantity, setQuantity] = useState(quantityText(line.quantity))
  const [unit, setUnit] = useState<QuantityUnit>(line.unit ?? 'each')
  const parsedQuantity = quantity.trim() ? parseQuantity(quantity) : 1
  const quantityOk = validQuantity(parsedQuantity)
  const dirty =
    tripId !== line.tripId || store.trim() !== (line.storeName ?? '') || parseAmount(price) !== line.price ||
    parsedQuantity !== (line.quantity ?? 1) || unit !== (line.unit ?? 'each')

  const save = useMutation({
    mutationFn: (body: SaveItemLineRequest) => api.catalog.updateLine(itemId, line.id, body),
    onSuccess: () => {
      invalidateItemData(queryClient)
      toast('success', 'Purchase record saved.')
    },
    onError: (error) => toast('error', errorMessage(error, "Couldn't save this record.")),
  })
  const remove = useMutation({
    mutationFn: () => api.catalog.deleteLine(itemId, line.id),
    onSuccess: () => invalidateItemData(queryClient),
    onError: () => toast('error', "Couldn't remove this record."),
  })

  const onSave = async () => {
    let confirmLocked = false
    if (line.priceLocked) {
      confirmLocked = await confirm({
        title: 'Correct a locked record?',
        body: 'This price was entered more than 7 days ago, so it is read-only in the trip editor. Saving here changes the price history and averages.',
        confirmLabel: 'Save correction',
      })
      if (!confirmLocked) return
    }
    save.mutate({ tripId, storeName: store.trim() || null, price: parseAmount(price), confirmLocked, quantity: parsedQuantity ?? 1, unit })
  }
  const onRemove = async () => {
    const ok = await confirm({
      title: 'Remove this purchase record?',
      body: `Takes it off the ${line.tripDate} trip${line.price != null ? ` and out of the price history (${money(line.price)})` : ''}.`,
      confirmLabel: 'Remove',
    })
    if (ok) remove.mutate()
  }

  return (
    <div className="grid grid-cols-2 items-center gap-2 rounded-[14px] border border-divider bg-bg p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_8.5rem_104px_auto]">
      <div className="col-span-2 sm:col-span-1">
        <TripSelect value={tripId} trips={trips} onChange={setTripId} disabled={!online} current={line} />
      </div>
      <Combobox
        aria-label="Store"
        placeholder={line.effectiveStoreName ? `${line.effectiveStoreName} (trip)` : 'Any store'}
        value={store}
        options={storeOptions}
        disabled={!online}
        onChange={setStore}
      />
      <QuantityField quantity={quantity} unit={unit} onQuantity={setQuantity} onUnit={setUnit} disabled={!online} />
      <input
        className="input"
        type="number"
        step="0.01"
        min="0"
        inputMode="decimal"
        aria-label="Price paid"
        placeholder="Planned"
        value={price}
        disabled={!online}
        onChange={(e) => setPrice(e.target.value)}
      />
      <div className="col-span-2 flex items-center justify-end gap-1.5 sm:col-span-1">
        {line.priceLocked && (
          <span className="tag tag-neutral h-8 w-8 justify-center p-0" role="img" aria-label="Locked in the trip editor" title="Locked in the trip editor — saving needs confirmation">
            <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
              <path d="M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Z" />
            </svg>
          </span>
        )}
        <button type="button" className="btn btn-primary px-4" disabled={!online || !dirty || !tripId || !quantityOk || save.isPending} onClick={onSave}>
          Save
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon text-danger hover:bg-danger-bg"
          aria-label={`Remove the ${line.tripDate} record`}
          disabled={!online || remove.isPending}
          onClick={onRemove}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="col-span-2 text-xs text-text/60 sm:col-span-5">
        {line.profileName} · {line.tripStatus}
        {line.estimate != null && ` · estimated ${money(line.estimate)}`}
      </div>
    </div>
  )
}

function AddLine({
  itemId,
  trips,
  storeOptions,
  online,
}: {
  itemId: string
  trips: HouseholdTrip[]
  storeOptions: ComboOption[]
  online: boolean
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [tripId, setTripId] = useState('')
  const [store, setStore] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState<QuantityUnit>('each')
  const parsedQuantity = quantity.trim() ? parseQuantity(quantity) : 1

  const add = useMutation({
    mutationFn: () => api.catalog.addLine(itemId, { tripId, storeName: store.trim() || null, price: parseAmount(price), quantity: parsedQuantity ?? 1, unit }),
    onSuccess: () => {
      invalidateItemData(queryClient)
      setOpen(false)
      setTripId('')
      setStore('')
      setPrice('')
      setQuantity('')
      setUnit('each')
      toast('success', 'Purchase record added.')
    },
    onError: (error) => toast('error', errorMessage(error, "Couldn't add this record.")),
  })

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost self-start" disabled={!online} onClick={() => setOpen(true)}>
        + Add purchase record
      </button>
    )
  }
  return (
    <div className="grid grid-cols-2 items-center gap-2 rounded-[14px] border border-dashed border-control p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_8.5rem_104px_auto]">
      <div className="col-span-2 sm:col-span-1">
        <TripSelect value={tripId} trips={trips} onChange={setTripId} disabled={!online} />
      </div>
      <Combobox aria-label="Store" placeholder="Store" value={store} options={storeOptions} onChange={setStore} />
      <QuantityField quantity={quantity} unit={unit} onQuantity={setQuantity} onUnit={setUnit} />
      <input
        className="input"
        type="number"
        step="0.01"
        min="0"
        inputMode="decimal"
        aria-label="Price paid"
        placeholder="Price"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <div className="col-span-2 flex justify-end gap-1.5 sm:col-span-1">
        <button type="button" className="btn btn-secondary px-3.5" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary px-4" disabled={!tripId || !validQuantity(parsedQuantity) || add.isPending} onClick={() => add.mutate()}>
          Add
        </button>
      </div>
    </div>
  )
}

function MergeSection({
  itemId,
  itemName,
  lines,
  catalogue,
  online,
  onMerged,
}: {
  itemId: string
  itemName: string
  lines: ItemLine[]
  catalogue: { id: string; name: string }[]
  online: boolean
  onMerged: (targetId: string, sourceDeleted: boolean) => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [targetName, setTargetName] = useState('')
  const [store, setStore] = useState('')
  const [deleteIfEmpty, setDeleteIfEmpty] = useState(true)

  // Stores this item was bought at, by the same rule the server filters on.
  const storeCounts = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>()
    for (const line of lines) {
      if (!line.effectiveStoreName) continue
      const key = normalize(line.effectiveStoreName)
      const entry = counts.get(key) ?? { name: line.effectiveStoreName, count: 0 }
      entry.count++
      counts.set(key, entry)
    }
    return [...counts.values()].sort((a, b) => b.count - a.count)
  }, [lines])

  const targetOptions: ComboOption[] = useMemo(() => catalogue.map((i) => ({ value: i.name, label: i.name })), [catalogue])
  const target = catalogue.find((i) => normalize(i.name) === normalize(targetName))
  const moving = store ? (storeCounts.find((s) => s.name === store)?.count ?? 0) : lines.length
  const willDelete = deleteIfEmpty && moving === lines.length

  const merge = useMutation({
    mutationFn: () => api.catalog.merge(itemId, { targetItemId: target!.id, storeName: store || null, deleteSourceIfEmpty: deleteIfEmpty }),
    onSuccess: (result) => {
      invalidateItemData(queryClient)
      toast(
        'success',
        `Moved ${result.moved} ${result.moved === 1 ? 'record' : 'records'} to ${target!.name}${result.sourceDeleted ? ` and removed "${itemName}"` : ''}.`,
      )
      setTargetName('')
      onMerged(target!.id, result.sourceDeleted)
    },
    onError: () => toast('error', "Couldn't merge these items."),
  })

  const askMerge = async () => {
    const ok = await confirm({
      title: `Merge into "${target!.name}"?`,
      body:
        `Moves ${moving} ${moving === 1 ? 'record' : 'records'}${store ? ` bought at ${store}` : ''} from "${itemName}" to "${target!.name}". ` +
        (willDelete ? `"${itemName}" is then deleted.` : `"${itemName}" stays, with its other records.`),
      confirmLabel: 'Merge',
    })
    if (ok) merge.mutate()
  }

  return (
    <section className="card elev-md gap-3" aria-labelledby="item-merge">
      <div>
        <h4 id="item-merge" className="m-0 text-lg">
          Merge into another item
        </h4>
        <p className="m-0 mt-0.5 text-xs text-text/60">
          For duplicates like "milk" and "whole milk": move this item's records to the other one, optionally only those from one store.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="merge-target">Move records to</label>
          <Combobox
            id="merge-target"
            placeholder="Item name"
            value={targetName}
            options={targetOptions}
            disabled={!online}
            onChange={setTargetName}
          />
        </div>
        <div className="field">
          <label htmlFor="merge-store">From store</label>
          <select id="merge-store" className="input" value={store} disabled={!online} onChange={(e) => setStore(e.target.value)}>
            <option value="">All stores ({lines.length})</option>
            {storeCounts.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.count})
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
        <input type="checkbox" className="h-5 w-5 accent-accent" checked={deleteIfEmpty} disabled={!online} onChange={(e) => setDeleteIfEmpty(e.target.checked)} />
        Delete "{itemName}" once it has no records left
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-text/60">
          {targetName && !target ? `No item called "${targetName.trim()}".` : target ? `${moving} ${moving === 1 ? 'record' : 'records'} will move.` : ''}
        </span>
        <button type="button" className="btn btn-primary" disabled={!online || !target || moving === 0 || merge.isPending} onClick={askMerge}>
          Merge
        </button>
      </div>
    </section>
  )
}

// The names stores print for this item on receipts, learned from receipts the household applied (or
// added here). Any can be corrected — the printed text, the item code, the store, or which item it
// really is — or removed, so the next receipt asks again for that line.
function ReceiptNames({ itemId, online }: { itemId: string; online: boolean }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data: aliases } = useQuery({ queryKey: ['item-aliases', itemId], queryFn: () => api.receipts.aliases(itemId) })
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['item-aliases'] })
  const remove = useMutation({
    mutationFn: (aliasId: string) => api.receipts.deleteAlias(aliasId),
    onSuccess: refresh,
    onError: () => toast('error', "Couldn't remove that receipt name."),
  })

  return (
    <section aria-labelledby="receipt-names" className="card elev-md gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 id="receipt-names" className="m-0 text-lg">
            Receipt names
          </h4>
          <p className="m-0 mt-0.5 text-xs text-text/60">How stores print this item. Receipts with these lines match it without asking.</p>
        </div>
        {editing !== 'new' && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={!online} onClick={() => setEditing('new')}>
            + Add receipt name
          </button>
        )}
      </div>
      {editing === 'new' && <AliasForm itemId={itemId} onDone={() => setEditing(null)} />}
      {aliases && aliases.length === 0 && editing !== 'new' && (
        <p className="m-0 text-sm text-text/70">None yet. They're learned from receipts you import, or add one here.</p>
      )}
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {aliases?.map((a) =>
          editing === a.id ? (
            <li key={a.id}>
              <AliasForm itemId={itemId} alias={a} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={a.id} className="flex items-center gap-2.5 rounded-[12px] border border-divider bg-bg py-1 pr-1 pl-3.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px]">{a.label}</span>
                <span className="block text-xs text-text/70">
                  {[a.storeName, a.code ? `#${a.code}` : null, `${a.timesUsed}×`, a.lastUsed].filter(Boolean).join(' · ')}
                </span>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Edit "${a.label}" at ${a.storeName}`} disabled={!online} onClick={() => setEditing(a.id)}>
                Edit
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon text-text/60 hover:bg-danger-bg hover:text-danger"
                aria-label={`Forget "${a.label}" at ${a.storeName}`}
                disabled={!online || remove.isPending}
                onClick={() => remove.mutate(a.id)}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  )
}

function AliasForm({ itemId, alias, onDone }: { itemId: string; alias?: ItemAlias; onDone: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data: stores } = useQuery({ queryKey: ['stores'], queryFn: () => api.stores.search() })
  const { data: catalogue } = useQuery({ queryKey: ['items'], queryFn: () => api.items.search() })
  const [label, setLabel] = useState(alias?.label ?? '')
  const [code, setCode] = useState(alias?.code ?? '')
  const [store, setStore] = useState(alias?.storeName ?? '')
  const [itemName, setItemName] = useState(alias?.itemName ?? '')
  const [error, setError] = useState<string | null>(null)
  const storeOptions: ComboOption[] = useMemo(() => (stores ?? []).map((s) => ({ value: s.name, label: s.name })), [stores])
  const itemOptions: ComboOption[] = useMemo(() => (catalogue ?? []).map((i) => ({ value: i.name, label: i.name })), [catalogue])
  const target = alias ? (catalogue ?? []).find((i) => normalize(i.name) === normalize(itemName)) : undefined

  const save = useMutation({
    mutationFn: () => {
      const body = { storeName: store.trim(), label: label.trim(), code: code.trim() || null, ...(alias && target ? { itemId: target.id } : {}) }
      return alias ? api.receipts.updateAlias(alias.id, body) : api.receipts.addAlias(itemId, body)
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['item-aliases'] })
      toast('success', saved.itemId === itemId ? 'Receipt name saved.' : `Receipt name moved to ${saved.itemName}.`)
      onDone()
    },
    onError: (e) => setError(errorMessage(e, "Couldn't save this receipt name.")),
  })

  const missingItem = !!alias && !!itemName.trim() && !target
  return (
    <form
      className="grid gap-2 rounded-[14px] border border-dashed border-control p-3 sm:grid-cols-2"
      aria-label={alias ? `Edit receipt name ${alias.label}` : 'Add a receipt name'}
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        save.mutate()
      }}
    >
      <div className="field">
        <label htmlFor={`alias-label-${alias?.id ?? 'new'}`}>As printed</label>
        <input id={`alias-label-${alias?.id ?? 'new'}`} className="input font-mono text-[13px]" maxLength={200} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. REDCD SODIUM BROTH" />
      </div>
      <div className="field">
        <label htmlFor={`alias-code-${alias?.id ?? 'new'}`}>Item code (optional)</label>
        <input id={`alias-code-${alias?.id ?? 'new'}`} className="input font-mono text-[13px]" inputMode="numeric" maxLength={40} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 343190" />
      </div>
      <div className="field">
        <label>Store</label>
        <Combobox className="input" aria-label="Store for this receipt name" value={store} options={storeOptions} minChars={0} onChange={setStore} />
      </div>
      {alias && (
        <div className="field">
          <label>Item</label>
          <Combobox className="input" aria-label="Item this receipt name means" value={itemName} options={itemOptions} onChange={setItemName} />
        </div>
      )}
      <p className="m-0 text-xs text-text/60 sm:col-span-2">
        With an item code, receipts match on the code (stores reword descriptions); without one, on the printed text.
      </p>
      {(error || missingItem) && (
        <p role="alert" className="m-0 text-sm text-danger sm:col-span-2">
          {missingItem ? `“${itemName}” isn't an item yet — pick one from the list.` : error}
        </p>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!label.trim() || !store.trim() || missingItem || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

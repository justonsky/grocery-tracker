import { useEffect, useState } from 'react'
import type { Category, TripStatus } from '../api/types'
import { summarize } from '../trips/costSummary'
import { Combobox, type ComboOption } from './ui/Combobox'

const money = (n: number) => `$${n.toFixed(2)}`
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const parseAmount = (value: string) => {
  const n = Number.parseFloat(value)
  return value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null
}

// A row is both a planned item and a bought one: estimate it, tick it off and
// fill the price as you shop. Amounts stay strings so a field can be left blank.
export interface DraftItem {
  key: string
  // The server line this row was loaded from; null for a row added here. Sent
  // back on save so the server can tell an edited line from a replaced one.
  id: string | null
  itemName: string
  categoryId: string
  storeName: string | null
  checked: boolean
  estimate: string
  price: string
  // Read-only: its price was entered more than 7 days ago (server's verdict at load).
  locked: boolean
  priceLocksAt: string | null
}

interface ListProps {
  items: DraftItem[]
  stores: string[]
  status: TripStatus
  categories: Category[] | undefined
  itemOptions: ComboOption[]
  averageFor: (itemName: string) => number | null
  onUpdate: (key: string, patch: Partial<DraftItem>) => void
  onName: (key: string, text: string) => void
  onPrice: (item: DraftItem, text: string) => void
  onRemove: (key: string) => void
  onAdd: (storeName: string | null) => void
}

function useIsWide() {
  const query = '(min-width: 640px)'
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const listener = (e: MediaQueryListEvent) => setWide(e.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])
  return wide
}

const LockIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
    <path d="M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Z" />
  </svg>
)

// The trip's items, grouped by store so a long list reads as a few short ones.
// Each store collapses; while shopping, ticked items drop into a collapsed "In
// the cart" group so what's left to find stays at the top.
export function TripItemList(props: ListProps) {
  const { items, stores, status } = props
  const wide = useIsWide()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [cartOpen, setCartOpen] = useState<Set<string>>(() => new Set())
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  // Trip stores in order, then any store a line uses that isn't on the trip, then unassigned.
  const extraStores = [...new Set(items.map((i) => i.storeName).filter((s): s is string => !!s && !stores.includes(s)))]
  const sections: (string | null)[] = [...stores, ...extraStores]
  if (items.some((i) => !i.storeName) || sections.length === 0) sections.push(null)
  const showHeaders = sections.some((s) => s !== null)
  const shopping = status === 'shopping'

  return (
    <div className="grid gap-3">
      {wide && (
        <div className="grid grid-cols-[auto_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] gap-2 text-[11px] tracking-wide text-text/60 uppercase">
          <span className="w-6" />
          <span>Item</span>
          <span>Category</span>
          <span>Store</span>
          <span>Estimate</span>
          <span>Paid</span>
          <span className="w-9" />
        </div>
      )}
      {sections.map((storeName) => {
        const key = storeName ?? ''
        const sectionItems = items.filter((i) => (i.storeName ?? null) === storeName)
        const named = sectionItems.filter((i) => i.itemName.trim())
        const toFind = shopping ? sectionItems.filter((i) => !i.checked) : sectionItems
        const inCart = shopping ? sectionItems.filter((i) => i.checked) : []
        const totals = summarize(named.map((i) => ({ storeName, estimate: parseAmount(i.estimate), price: parseAmount(i.price) })))
        const picked = named.filter((i) => i.checked).length
        const isCollapsed = collapsed.has(key)
        const cartIsOpen = cartOpen.has(key)

        return (
          <section key={key} aria-label={storeName ?? 'Any store'} className="grid gap-2">
            {showHeaders && (
              <button
                type="button"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((s) => toggle(s, key))}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-text/5 px-2.5 py-2 text-left text-sm text-text hover:bg-text/8"
              >
                <span aria-hidden="true" className={`inline-block text-xs transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>
                  ▸
                </span>
                <span className="font-medium">{storeName ?? 'Any store'}</span>
                <span className="text-xs text-text/55">
                  {named.length} {named.length === 1 ? 'item' : 'items'}
                  {picked > 0 && ` · ${picked} picked up`}
                </span>
                <span className="ml-auto text-xs text-text/70">
                  {totals.pricedCount > 0 ? money(totals.spent) : totals.estimatedCount > 0 ? `est. ${money(totals.estimated)}` : ''}
                </span>
              </button>
            )}
            {!isCollapsed && (
              <>
                {toFind.map((item) => (
                  <ItemRow key={item.key} item={item} wide={wide} {...props} />
                ))}
                {shopping && toFind.length === 0 && named.length > 0 && (
                  <p className="m-0 px-1 text-xs text-text/55">Everything here is in the cart.</p>
                )}
                {inCart.length > 0 && (
                  <div className="grid gap-2">
                    <button
                      type="button"
                      aria-expanded={cartIsOpen}
                      onClick={() => setCartOpen((s) => toggle(s, key))}
                      className="btn btn-ghost justify-self-start px-1 text-xs"
                    >
                      {cartIsOpen ? 'Hide' : 'Show'} {inCart.length} in the cart
                    </button>
                    {cartIsOpen && inCart.map((item) => <ItemRow key={item.key} item={item} wide={wide} {...props} />)}
                  </div>
                )}
                <button type="button" className="btn btn-ghost justify-self-start" onClick={() => props.onAdd(storeName)}>
                  + Add item{storeName ? ` at ${storeName}` : ''}
                </button>
              </>
            )}
          </section>
        )
      })}
    </div>
  )
}

function ItemRow({
  item,
  wide,
  stores,
  status,
  categories,
  itemOptions,
  averageFor,
  onUpdate,
  onName,
  onPrice,
  onRemove,
}: ListProps & { item: DraftItem; wide: boolean }) {
  const [open, setOpen] = useState(false)
  const average = averageFor(item.itemName)
  const estimate = parseAmount(item.estimate)
  const struck = item.checked && status !== 'planned'

  const checkbox = (
    <input
      type="checkbox"
      title="Picked up"
      aria-label={`Picked up ${item.itemName || 'item'}`}
      checked={item.checked}
      disabled={item.locked}
      onChange={(e) => onUpdate(item.key, { checked: e.target.checked })}
      className="h-6 w-6 shrink-0 accent-accent"
    />
  )
  const name = (
    <Combobox
      className={struck ? 'text-text/60 line-through' : ''}
      placeholder="Item name"
      aria-label="Item name"
      value={item.itemName}
      disabled={item.locked}
      options={itemOptions}
      onChange={(text) => onName(item.key, text)}
    />
  )
  const category = (
    <select
      className="input"
      aria-label="Category"
      value={item.categoryId}
      disabled={item.locked}
      onChange={(e) => onUpdate(item.key, { categoryId: e.target.value })}
    >
      {categories?.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
  const store = (
    <select
      className="input"
      aria-label="Store"
      value={item.storeName ?? ''}
      disabled={item.locked}
      onChange={(e) => onUpdate(item.key, { storeName: e.target.value || null })}
    >
      <option value="">Any store</option>
      {/* Keep a store that's no longer on the trip selectable for the line that uses it. */}
      {[...stores, ...(item.storeName && !stores.includes(item.storeName) ? [item.storeName] : [])].map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
  const estimateInput = (
    <input
      className="input"
      type="number"
      step="0.01"
      min="0"
      inputMode="decimal"
      placeholder={average != null ? `avg ${average.toFixed(2)}` : 'Estimate'}
      aria-label="Estimate"
      title={average != null ? `Household average: ${money(average)}` : 'No price history for this item yet'}
      value={item.estimate}
      disabled={item.locked}
      onChange={(e) => onUpdate(item.key, { estimate: e.target.value })}
    />
  )
  const paid = (
    <input
      className="input"
      type="number"
      step="0.01"
      min="0"
      inputMode="decimal"
      // On a phone the estimate field is tucked away, so its value shows here.
      placeholder={!wide && estimate != null ? `est ${estimate.toFixed(2)}` : 'Paid'}
      aria-label="Price paid"
      title={item.locked ? 'Locked' : item.priceLocksAt ? `Editable until ${shortDate(item.priceLocksAt)}` : 'Becomes read-only 7 days after you enter it'}
      value={item.price}
      disabled={item.locked}
      onChange={(e) => onPrice(item, e.target.value)}
    />
  )
  const lock = (
    <span
      className="flex h-9 w-9 items-center justify-center text-text/60"
      role="img"
      aria-label="Locked — prices become read-only 7 days after they're entered"
      title="Locked — prices become read-only 7 days after they're entered"
    >
      <LockIcon size={15} />
    </span>
  )

  if (wide) {
    return (
      <div
        className={`grid grid-cols-[auto_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] items-center gap-2 ${item.locked ? 'opacity-75' : ''}`}
      >
        {checkbox}
        {name}
        {category}
        {store}
        {estimateInput}
        {paid}
        {item.locked ? (
          lock
        ) : (
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove item" onClick={() => onRemove(item.key)}>
            ×
          </button>
        )}
      </div>
    )
  }

  // Phone: one line (tick, name, paid); everything else behind ⋯.
  const categoryName = categories?.find((c) => c.id === item.categoryId)?.name
  const meta = [categoryName, estimate == null && average != null ? `avg ${money(average)}` : null].filter(Boolean).join(' · ')
  return (
    <div className={`grid grid-cols-[auto_minmax(0,1fr)_5.5rem_auto] items-center gap-x-2 gap-y-1 ${item.locked ? 'opacity-75' : ''}`}>
      {checkbox}
      {name}
      {paid}
      <button
        type="button"
        className="btn btn-ghost btn-icon h-11 w-9"
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} details for ${item.itemName || 'item'}`}
        onClick={() => setOpen((o) => !o)}
      >
        {item.locked ? <LockIcon /> : '⋯'}
      </button>
      {!open && meta && <div className="col-start-2 col-end-5 -mt-0.5 truncate px-1 text-[11px] text-text/50">{meta}</div>}
      {open && (
        <div className="col-start-2 col-end-5 grid grid-cols-2 gap-2 pb-1">
          {category}
          {store}
          {estimateInput}
          {item.locked ? (
            <span className="flex items-center gap-1.5 text-xs text-text/60">
              <LockIcon /> Locked
            </span>
          ) : (
            <button type="button" className="btn btn-secondary" style={{ color: 'var(--color-danger)' }} onClick={() => onRemove(item.key)}>
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  )
}

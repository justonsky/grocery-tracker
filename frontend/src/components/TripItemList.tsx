import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { Category, PriceUnit, QuantityUnit, TripStatus } from '../api/types'
import { parseQuantity, perUnit, quantityLabel } from '../trips/quantity'
import { QuantityField } from './QuantityField'
import { summarize } from '../trips/costSummary'
import { STORE_DEFAULT_COLORS, slug } from '../trips/shareGroups'
import { Combobox, type ComboOption } from './ui/Combobox'

const money = (n: number) => `$${n.toFixed(2)}`

export interface LineAverage {
  average: number
  priceUnit: PriceUnit
  // average × the line's quantity; null when the units don't compare (bought by weight vs by count).
  lineEstimate: number | null
}
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const norm = (name: string | null) => (name ?? '').trim().toLowerCase()
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
  // How much the line buys, as typed ("2", "3/4"; blank = 1), and its unit. The price is the line total.
  quantity: string
  unit: QuantityUnit
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
  // The item's household average (per item or per pound) and what it makes this line's estimate.
  averageFor: (item: DraftItem) => LineAverage | null
  onUpdate: (key: string, patch: Partial<DraftItem>) => void
  onName: (key: string, text: string) => void
  // A suggestion was chosen (not just typed): may also set the line's unit.
  onPick: (key: string, name: string) => void
  onPrice: (item: DraftItem, text: string) => void
  onRemove: (key: string) => void
  onAdd: (storeName: string | null) => void
  onAddRecipe: (storeName: string | null) => void
  // Offered when receipt import is set up and turned on (and the server is reachable).
  onImportReceipt?: (storeName: string | null) => void
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

// Wide rows: tick, item, quantity, category, store, estimate, paid, remove/lock.
const WIDE_COLS =
  'grid grid-cols-[auto_minmax(0,1.5fr)_8.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto]'

const LockIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)
const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
const MoreIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
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

  // Trip stores in order, then any store a line uses that isn't on the trip, then
  // unassigned. Matched ignoring case, so "aldi" and "Aldi" are one section.
  const extraStores = [
    ...new Map(
      items
        .map((i) => i.storeName)
        .filter((s): s is string => !!s && !stores.some((t) => norm(t) === norm(s)))
        .map((s) => [norm(s), s] as const),
    ).values(),
  ]
  const sections: (string | null)[] = [...stores, ...extraStores]
  if (items.some((i) => !i.storeName) || sections.length === 0) sections.push(null)
  const showHeaders = sections.some((s) => s !== null)
  const shopping = status === 'shopping'

  return (
    <div className="grid gap-3">
      {wide && (
        <div
          aria-hidden="true"
          className={`${WIDE_COLS} gap-2 px-4 text-[11px] font-bold tracking-[0.08em] text-text/60 uppercase`}
        >
          <span className="w-11" />
          <span>Item</span>
          <span>Qty</span>
          <span>Category</span>
          <span>Store</span>
          <span>Estimate</span>
          <span>Paid</span>
          <span className="w-11" />
        </div>
      )}
      {sections.map((storeName) => {
        const key = storeName ?? ''
        const sectionItems = items.filter((i) => (storeName === null ? !i.storeName : norm(i.storeName) === norm(storeName)))
        const named = sectionItems.filter((i) => i.itemName.trim())
        const toFind = shopping ? sectionItems.filter((i) => !i.checked) : sectionItems
        const inCart = shopping ? sectionItems.filter((i) => i.checked) : []
        const totals = summarize(named.map((i) => ({ storeName, estimate: parseAmount(i.estimate), price: parseAmount(i.price) })))
        const picked = named.filter((i) => i.checked).length
        const isCollapsed = collapsed.has(key)
        const cartIsOpen = cartOpen.has(key)
        const tint = storeName ? STORE_DEFAULT_COLORS[slug(storeName)] : undefined

        return (
          // No overflow-hidden here: it would clip the item-name suggestion list.
          <section key={key} aria-label={storeName ?? 'Any store'} className="card elev-sm gap-0 p-0">
            {showHeaders && (
              <button
                type="button"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((s) => toggle(s, key))}
                // Regular stores keep their share-card tint, blended into the
                // surface (lighter blend in dark mode so the ink stays legible).
                style={tint ? ({ '--tint': tint } as CSSProperties) : undefined}
                className={`flex min-h-13 w-full cursor-pointer items-center gap-2.5 border-0 px-3.5 text-left text-[15px] text-text hover:brightness-[0.98] sm:min-h-14 sm:px-4 ${
                  isCollapsed ? 'rounded-[18px]' : 'rounded-t-[18px]'
                } ${
                  tint
                    ? 'bg-[color-mix(in_srgb,var(--tint)_60%,var(--color-surface))] dark:bg-[color-mix(in_srgb,var(--tint)_16%,var(--color-surface))]'
                    : 'bg-chip'
                }`}
              >
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
                <span className="min-w-0 flex-1 truncate font-bold">{storeName ?? 'Any store'}</span>
                <span className="shrink-0 text-xs font-medium text-text/70 sm:text-[13px]">
                  {picked > 0 || shopping
                    ? `${picked}/${named.length} picked up`
                    : `${named.length} ${named.length === 1 ? 'item' : 'items'}`}
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums">
                  {totals.pricedCount > 0 ? money(totals.spent) : totals.estimatedCount > 0 ? `est ${money(totals.estimated)}` : ''}
                </span>
              </button>
            )}
            {!isCollapsed && (
              <div className="flex flex-col">
                {toFind.map((item, i) => (
                  <ItemRow key={item.key} item={item} wide={wide} first={!showHeaders && i === 0} {...props} />
                ))}
                {shopping && toFind.length === 0 && named.length > 0 && (
                  <p className={`m-0 px-4 py-3 text-xs text-text/60 ${showHeaders ? 'border-t border-divider' : ''}`}>
                    Everything here is in the cart.
                  </p>
                )}
                {inCart.length > 0 && (
                  <>
                    <button
                      type="button"
                      aria-expanded={cartIsOpen}
                      onClick={() => setCartOpen((s) => toggle(s, key))}
                      className="flex min-h-12 w-full cursor-pointer items-center gap-2 border-0 border-t border-divider bg-bg px-4 text-left text-[13px] font-semibold text-accent-200 hover:bg-chip"
                    >
                      <svg
                        aria-hidden="true"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      {cartIsOpen ? 'Hide' : 'Show'} {inCart.length} in the cart
                    </button>
                    {cartIsOpen && inCart.map((item) => <ItemRow key={item.key} item={item} wide={wide} first={false} {...props} />)}
                  </>
                )}
                <div className={`px-2 py-1 sm:px-2.5 ${showHeaders || sectionItems.length > 0 ? 'border-t border-divider' : ''}`}>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className="btn btn-ghost px-2" onClick={() => props.onAdd(storeName)}>
                      + Add item{storeName ? ` at ${storeName}` : ''}
                    </button>
                    <button type="button" className="btn btn-ghost px-2" onClick={() => props.onAddRecipe(storeName)}>
                      + Add recipe
                    </button>
                    {props.onImportReceipt && (
                      <button type="button" className="btn btn-ghost px-2" onClick={() => props.onImportReceipt!(storeName)}>
                        Import receipt
                      </button>
                    )}
                  </div>
                </div>
              </div>
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
  first,
  stores,
  status,
  categories,
  itemOptions,
  averageFor,
  onUpdate,
  onName,
  onPick,
  onPrice,
  onRemove,
}: ListProps & { item: DraftItem; wide: boolean; first: boolean }) {
  const [open, setOpen] = useState(false)
  const average = averageFor(item)
  const estimate = parseAmount(item.estimate)
  const amountLabel = quantityLabel(parseQuantity(item.quantity) ?? 1, item.unit)
  const struck = item.checked && status !== 'planned'

  // Wrapped in a label so the whole 44px square ticks it, not just the box.
  const checkbox = (
    <label className={`flex h-11 w-11 shrink-0 items-center justify-center ${item.locked ? '' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        title="Picked up"
        aria-label={`Picked up ${item.itemName || 'item'}`}
        checked={item.checked}
        disabled={item.locked}
        onChange={(e) => onUpdate(item.key, { checked: e.target.checked })}
        className="h-[22px] w-[22px] cursor-[inherit] accent-accent"
      />
    </label>
  )
  const name = (
    <Combobox
      className={`font-semibold ${struck ? 'text-text/60 line-through' : ''}`}
      placeholder="Item name"
      aria-label="Item name"
      value={item.itemName}
      disabled={item.locked}
      options={itemOptions}
      onChange={(text) => onName(item.key, text)}
      onSelect={(option) => onPick(item.key, option.value)}
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
      {[...stores, ...(item.storeName && !stores.some((s) => norm(s) === norm(item.storeName)) ? [item.storeName] : [])].map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
  const estimateInput = (
    <input
      className="input tabular-nums"
      type="number"
      step="0.01"
      min="0"
      inputMode="decimal"
      // Desktop: the column header says Estimate, so the average can sit in the empty field. On a
      // phone the field has a label and the average is shown beside it instead (it looked like a value).
      placeholder={wide && average?.lineEstimate != null ? `avg ${average.lineEstimate.toFixed(2)}` : 'Expected cost'}
      aria-label="Estimate"
      title={average != null ? `Household average: ${money(average.average)}${perUnit(average.priceUnit)}` : 'No price history for this item yet'}
      value={item.estimate}
      disabled={item.locked}
      onChange={(e) => onUpdate(item.key, { estimate: e.target.value })}
    />
  )
  const paid = (
    <input
      className="input tabular-nums"
      type="number"
      step="0.01"
      min="0"
      inputMode="decimal"
      placeholder="Paid"
      aria-label="Price paid"
      title={item.locked ? 'Locked' : item.priceLocksAt ? `Editable until ${shortDate(item.priceLocksAt)}` : 'Becomes read-only 7 days after you enter it'}
      value={item.price}
      disabled={item.locked}
      onChange={(e) => onPrice(item, e.target.value)}
    />
  )
  const quantityInput = (
    <QuantityField
      quantity={item.quantity}
      unit={item.unit}
      disabled={item.locked}
      onQuantity={(text) => onUpdate(item.key, { quantity: text })}
      onUnit={(unit) => onUpdate(item.key, { unit })}
    />
  )
  const lock = (
    <span
      className="flex h-11 w-11 items-center justify-center text-text/60"
      role="img"
      aria-label="Locked — prices become read-only 7 days after they're entered"
      title="Locked — prices become read-only 7 days after they're entered"
    >
      <LockIcon size={15} />
    </span>
  )

  if (wide) {
    return (
      <div className={`${WIDE_COLS} items-center gap-2 py-1.5 pr-2 pl-2 ${first ? '' : 'border-t border-divider'} ${item.locked ? 'opacity-75' : ''}`}>
        {checkbox}
        {name}
        {quantityInput}
        {category}
        {store}
        {estimateInput}
        {paid}
        {item.locked ? (
          lock
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-icon text-text/60 hover:bg-danger-bg hover:text-danger"
            aria-label="Remove item"
            onClick={() => onRemove(item.key)}
          >
            <CloseIcon />
          </button>
        )}
      </div>
    )
  }

  // Phone: one line (tick, name, paid); everything else behind ⋯.
  const categoryName = categories?.find((c) => c.id === item.categoryId)?.name
  // The estimate lives behind ⋯ on a phone, so the summary line says what it is (or the average).
  const meta = [
    amountLabel || null,
    categoryName,
    estimate != null ? `est ${money(estimate)}` : average != null ? `avg ${money(average.average)}${perUnit(average.priceUnit)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div
      className={`grid grid-cols-[auto_minmax(0,1fr)_5.5rem_auto] items-center gap-x-1.5 gap-y-1 py-1.5 pr-1 pl-0.5 ${
        first ? '' : 'border-t border-divider'
      } ${item.locked ? 'opacity-75' : ''}`}
    >
      {checkbox}
      {name}
      {paid}
      <button
        type="button"
        className="btn btn-ghost btn-icon text-text/70"
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} details for ${item.itemName || 'item'}`}
        onClick={() => setOpen((o) => !o)}
      >
        {item.locked ? <LockIcon size={16} /> : <MoreIcon />}
      </button>
      {!open && meta && <div className="col-start-2 col-end-5 -mt-1 truncate px-1 pb-0.5 text-xs text-text/60">{meta}</div>}
      {open && (
        <div className="col-start-2 col-end-5 grid grid-cols-2 gap-x-2 gap-y-2.5 pr-1 pb-1.5">
          <PhoneField label="Quantity" className="col-span-2">
            {quantityInput}
          </PhoneField>
          <PhoneField label="Category">{category}</PhoneField>
          <PhoneField label="Store">{store}</PhoneField>
          <PhoneField label="Estimate" className="col-span-2">
            {estimateInput}
            {average != null && (
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-text/70">
                Household average {money(average.average)}
                {perUnit(average.priceUnit)}
                {average.lineEstimate != null && !item.locked && item.estimate !== average.lineEstimate.toFixed(2) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm min-h-9 px-2 text-accent-200"
                    onClick={() => onUpdate(item.key, { estimate: average.lineEstimate!.toFixed(2) })}
                  >
                    Use {money(average.lineEstimate)}
                  </button>
                )}
              </span>
            )}
          </PhoneField>
          {item.locked ? (
            <span className="col-span-2 flex items-center gap-1.5 text-xs text-text/60">
              <LockIcon /> Locked
            </span>
          ) : (
            <button type="button" className="btn btn-danger col-span-2" onClick={() => onRemove(item.key)}>
              Remove item
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// A labelled field in a phone row's details (the row itself is too narrow for labels).
function PhoneField({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`grid min-w-0 content-start gap-1 ${className}`}>
      <span className="text-xs font-semibold text-text/65" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  )
}

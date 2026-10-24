import type { QuantityUnit } from '../api/types'
import { UNITS, parseQuantity, validQuantity } from '../trips/quantity'

// How much a line bought: a number typed as text (so "3/4" and "1 1/2" work; blank = 1) and its
// unit — each, or a weight. Flags anything that isn't a quantity.
export function QuantityField({
  quantity,
  unit,
  onQuantity,
  onUnit,
  disabled,
  label = 'Quantity',
}: {
  quantity: string
  unit: QuantityUnit
  onQuantity: (text: string) => void
  onUnit: (unit: QuantityUnit) => void
  disabled?: boolean
  label?: string
}) {
  const ok = !quantity.trim() || validQuantity(parseQuantity(quantity))
  return (
    <div className="flex min-w-0 gap-1">
      <input
        className={`input w-14 shrink-0 px-2 text-center tabular-nums ${ok ? '' : 'border-danger'}`}
        // Text, not decimal: phone decimal keypads have no "/" for amounts like 3/4.
        inputMode="text"
        enterKeyHint="next"
        placeholder="1"
        aria-label={label}
        aria-invalid={!ok}
        title={ok ? 'How many, or how much (e.g. 3/4)' : 'Use a number like 2, 0.75 or 3/4'}
        value={quantity}
        disabled={disabled}
        onChange={(e) => onQuantity(e.target.value)}
      />
      <select className="input min-w-0 flex-1 px-1.5" aria-label="Unit" value={unit} disabled={disabled} onChange={(e) => onUnit(e.target.value as QuantityUnit)}>
        {UNITS.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// The text to show in a QuantityField for a stored quantity (1 shows as blank).
export const quantityText = (quantity: number | null | undefined) => (quantity != null && quantity !== 1 ? String(quantity) : '')

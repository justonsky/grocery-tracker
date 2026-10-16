import type { PriceUnit, QuantityUnit } from '../api/types'

// A line's quantity and unit. Its price is always what the whole line cost; per-unit prices
// (averages, charts) are per item, or per pound for weights — the server does the same.
export const UNITS: { id: QuantityUnit; label: string }[] = [
  { id: 'each', label: 'each' },
  { id: 'lb', label: 'lb' },
  { id: 'oz', label: 'oz' },
  { id: 'kg', label: 'kg' },
  { id: 'g', label: 'g' },
]
const GRAMS: Record<string, number> = { lb: 453.59237, oz: 28.349523125, kg: 1000, g: 1 }
const FRACTIONS: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 }

export const isWeight = (unit: string) => unit in GRAMS
export const priceUnitOf = (unit: string): PriceUnit => (isWeight(unit) ? 'lb' : 'each')

// "2", "0.75", ".5", "3/4", "1 1/2", "¾", "1½" → a number; blank or nonsense → null.
// Kept to 3 decimals, like the server.
export function parseQuantity(text: string): number | null {
  let t = text.trim().replace(',', '.')
  if (!t) return null
  let extra = 0
  const glyph = [...t].find((c) => c in FRACTIONS)
  if (glyph) {
    extra = FRACTIONS[glyph]
    t = t.replace(glyph, '').trim()
    if (!t) return round(extra)
  }
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixed) return Number(mixed[3]) > 0 ? round(Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) + extra) : null
  const frac = t.match(/^(\d+)\/(\d+)$/)
  if (frac) return Number(frac[2]) > 0 ? round(Number(frac[1]) / Number(frac[2]) + extra) : null
  if (!/^\d*\.?\d+$/.test(t) && !/^\d+\.$/.test(t)) return null
  return round(Number(t) + extra)
}
const round = (n: number) => Math.round(n * 1000) / 1000

export const validQuantity = (n: number | null): n is number => n != null && n > 0 && n <= 9999

// "×2", "0.75 lb"; nothing for the default 1 each.
export function quantityLabel(quantity: number | null | undefined, unit: string | null | undefined): string {
  const q = quantity ?? 1
  const u = unit ?? 'each'
  if (u === 'each') return q === 1 ? '' : `×${trim(q)}`
  return `${trim(q)} ${u}`
}
const trim = (n: number) => String(Math.round(n * 1000) / 1000)

// "/lb" after a per-pound price; nothing after a per-item one.
export const perUnit = (priceUnit: string | null | undefined) => (priceUnit === 'lb' ? '/lb' : '')

// An estimate for a line from an item's average per-unit price: average × how much, when the
// line is in the same kind of unit (count vs weight); null when it can't be worked out.
export function estimateFrom(average: number, priceUnit: PriceUnit | undefined, quantity: number, unit: string): number | null {
  if ((priceUnit ?? 'each') !== priceUnitOf(unit)) return null
  const amount = isWeight(unit) ? (quantity * GRAMS[unit]) / GRAMS.lb : quantity
  return Math.round(average * amount * 100) / 100
}

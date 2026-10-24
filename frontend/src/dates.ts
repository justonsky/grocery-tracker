// Trip dates are the shopper's local calendar date, "yyyy-MM-dd" — never the UTC date, which on
// a US evening is already tomorrow (and on the last evening of a month, next month).
export function localIsoDate(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// "Aug 29, 2026" for a yyyy-MM-dd trip date. Parsed as a local date: new Date('2026-08-29') is
// UTC midnight, which is still Aug 28 west of Greenwich.
export function tripDateLabel(iso: string, options: { year?: boolean } = {}) {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(options.year === false ? {} : { year: 'numeric' }) })
}

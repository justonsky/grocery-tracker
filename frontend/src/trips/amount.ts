// Money fields always show cents: 3 → "3.00".
export const amountText = (n: number | null | undefined) => (n != null ? n.toFixed(2) : '')

// When a money field loses focus, a readable amount is rewritten with cents ("3" → "3.00");
// blank or unreadable text is left as typed.
export function tidyAmount(text: string) {
  const n = Number.parseFloat(text)
  return text.trim() !== '' && Number.isFinite(n) && n >= 0 ? n.toFixed(2) : text
}

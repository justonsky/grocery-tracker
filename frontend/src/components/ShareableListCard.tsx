import { forwardRef } from 'react'

export interface PreviewItem {
  itemName: string
  categoryName: string
  preferredStoreName: string | null
  checked: boolean
  // null for an item that has not been bought yet.
  price: number | null
}

interface Props {
  name: string
  date: string
  items: PreviewItem[]
  // Rendered as a summary line at the foot of the card so it survives PNG/JPG
  // export. Omitted when no item on the trip has an estimate.
  // The over-budget warning is deliberately NOT shown here — it is editor-only
  // context, not something to bake into a list shared with someone else.
  estimatedCostLabel?: string | null
}

// Fixed pixel width, not fluid/responsive — this is the exact DOM node
// html-to-image rasterizes for PNG/JPG export, so its output must not depend
// on ambient page zoom or Tailwind breakpoint state.
export const ShareableListCard = forwardRef<HTMLDivElement, Props>(function ShareableListCard(
  { name, date, items, estimatedCostLabel },
  ref,
) {
  const groups = new Map<string, PreviewItem[]>()
  for (const item of items) {
    if (!item.itemName.trim()) continue
    const key = item.categoryName || 'Other'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }

  return (
    <div
      ref={ref}
      className="grid gap-4"
      style={{
        width: 420,
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        borderRadius: 'var(--radius-lg)',
        padding: 28,
        boxShadow: 'var(--shadow-sm)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <div>
        <div className="card-kicker">Shopping list</div>
        <h3 className="my-0.5">{name}</h3>
        {date && <div className="text-xs text-text/70">{date}</div>}
      </div>
      {[...groups.entries()].map(([category, groupItems]) => (
        <div key={category}>
          <div className="mb-1.5 font-heading text-[13px] text-accent">{category}</div>
          <div className="grid gap-1.5">
            {groupItems.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span>{item.checked ? '☑' : '☐'}</span>
                <span className="flex-1">{item.itemName}</span>
                {item.preferredStoreName && <span className="tag tag-outline">{item.preferredStoreName}</span>}
                {item.price != null && <span style={{ minWidth: 52, textAlign: 'right' }}>${item.price.toFixed(2)}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
      {estimatedCostLabel && (
        <>
          <div className="hr" style={{ margin: 0 }} />
          <div className="flex justify-between text-sm">
            <span className="text-text/70">Estimated cost</span>
            <strong>{estimatedCostLabel}</strong>
          </div>
        </>
      )}
    </div>
  )
})

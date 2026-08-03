import { forwardRef } from 'react'

export interface PreviewItem {
  itemName: string
  categoryName: string
  preferredStoreName: string | null
  checked: boolean
}

interface Props {
  name: string
  date: string
  items: PreviewItem[]
}

// Fixed pixel width, not fluid/responsive — this is the exact DOM node
// html-to-image rasterizes for PNG/JPG export, so its output must not depend
// on ambient page zoom or Tailwind breakpoint state.
export const ShareableListCard = forwardRef<HTMLDivElement, Props>(function ShareableListCard(
  { name, date, items },
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
        <div className="card-kicker">Grocery list</div>
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
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
})

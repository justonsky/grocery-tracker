import { forwardRef } from 'react'
import { inkFor, type GroupBy, type ShareGroup, type ShareItem } from '../trips/shareGroups'

interface Props {
  name: string
  date: string
  groups: ShareGroup[]
  groupBy: GroupBy
  // Background per group key; null = no fill.
  colors: Map<string, string | null>
  // Rendered as a summary line at the foot of the card so it survives PNG/JPG
  // export. Omitted when no item on the trip has an estimate.
  // The over-budget warning is deliberately NOT shown here — it is editor-only
  // context, not something to bake into a list shared with someone else.
  estimatedCostLabel?: string | null
}

function Row({ item, showStore }: { item: ShareItem; showStore: boolean }) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
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
        className="shrink-0 opacity-80"
      >
        <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
        {item.checked && <path d="M8 12.5l3 3 5-6" />}
      </svg>
      <span className={`flex-1 font-medium ${item.checked ? 'opacity-60' : ''}`}>
        {item.itemName}
        {item.amount && <span className="ml-1.5 font-normal opacity-70">{item.amount}</span>}
      </span>
      {showStore && item.storeName && (
        <span className="inline-flex items-center rounded-full border border-current px-2 py-0.5 text-[11px] font-semibold tracking-wide opacity-80">
          {item.storeName}
        </span>
      )}
      {item.price != null && <span className="font-semibold tabular-nums" style={{ minWidth: 52, textAlign: 'right' }}>
          ${item.price.toFixed(2)}</span>}
    </div>
  )
}

// Fixed pixel width, not fluid/responsive — this is the exact DOM node
// html-to-image rasterizes for PNG/JPG export, so its output must not depend
// on ambient page zoom or Tailwind breakpoint state. Group fills carry their own
// ink color (dark on light fills), so the card reads the same in either theme.
export const ShareableListCard = forwardRef<HTMLDivElement, Props>(function ShareableListCard(
  { name, date, groups, groupBy, colors, estimatedCostLabel },
  ref,
) {
  // Grouped by store, each group heading already names it.
  const showStore = groupBy !== 'store'

  return (
    <div
      ref={ref}
      className="grid gap-3"
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
      <div className="mb-1">
        <div className="card-kicker">Shopping list</div>
        <h3 className="my-0.5">{name}</h3>
        {date && <div className="text-xs text-text/70">{date}</div>}
      </div>
      {groups.map((group) => {
        const fill = colors.get(group.key) ?? null
        return (
          <div
            key={group.key}
            style={fill ? { background: fill, color: inkFor(fill), borderRadius: 14, padding: '12px 14px' } : undefined}
          >
            {group.label && (
              <div className={`mb-1.5 font-heading text-[13px] ${fill ? 'font-semibold' : 'text-accent'}`}>
                {group.label}
                <span className="ml-1.5 font-normal opacity-60">{group.items.length}</span>
              </div>
            )}
            <div className="grid gap-1.5">
              {group.items.map((item, i) => (
                <Row key={i} item={item} showStore={showStore} />
              ))}
            </div>
          </div>
        )
      })}
      {estimatedCostLabel && (
        <>
          <div className="hr" style={{ margin: 0 }} />
          <div className="flex justify-between text-sm">
            <span className="text-text/70">Estimated cost</span>
            <strong className="font-heading text-base tabular-nums">{estimatedCostLabel}</strong>
          </div>
        </>
      )}
    </div>
  )
})

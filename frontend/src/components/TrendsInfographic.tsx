import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import type { CategorySpend, FadingItem, QuietRecipe, RisingItem, TrendItem, TrendRecipe, Trends } from '../api/types'
import { recipePhotoUrl } from '../recipes'

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
const dayYear = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1

const CHART_VARS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']
const RANGE_NAME: Record<string, string> = { '30d': 'the previous 30 days', '90d': 'the previous 90 days', '180d': 'the previous 6 months', '365d': 'the previous year' }

interface Props {
  trends: Trends
  profileName?: string
  // Items hidden by the user from the "buying more" / "gone quiet" lists.
  hidden?: Set<string>
  onHide?: (itemId: string) => void
  // The image-export copy: a fixed two-column layout, no buttons.
  wide?: boolean
}

function Section({ title, hint, children, className = '' }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`grid content-start gap-2.5 rounded-[18px] border border-divider bg-bg p-4 ${className}`}>
      <div>
        <h3 className="m-0 text-[17px]">{title}</h3>
        {hint && <div className="mt-0.5 text-xs text-text/60">{hint}</div>}
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-sm text-text/60">{children}</p>
}

function BarList({ items, value, label, color }: { items: TrendItem[]; value: (i: TrendItem) => number; label: (i: TrendItem) => string; color: string }) {
  const max = Math.max(...items.map(value), 1)
  return (
    <ol className="m-0 grid list-none gap-2 p-0">
      {items.map((item, i) => (
        <li key={item.itemId} className="grid gap-1">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="w-4 shrink-0 text-xs text-text/50 tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{item.name}</span>
            <span className="shrink-0 text-[13px] text-text/70 tabular-nums">{label(item)}</span>
          </div>
          <div className="ml-6 h-2 overflow-hidden rounded-full bg-chip" aria-hidden="true">
            <div className="h-full rounded-full" style={{ width: `${Math.max((value(item) / max) * 100, 3)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ol>
  )
}

function HideButton({ name, onHide }: { name: string; onHide?: () => void }) {
  if (!onHide) return null
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm -my-1.5 -mr-2 min-h-11 shrink-0 px-2 text-text/50 hover:text-text"
      aria-label={`Hide ${name} from this list`}
      title="Hide from this list"
      onClick={onHide}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  )
}

function Rising({ item, recentDays, onHide }: { item: RisingItem; recentDays: number; onHide?: () => void }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-800 text-accent-200" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17L17 7M9 7h8v8" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{item.name}</div>
        <div className="text-xs text-text/60">
          {item.recentCount}× in the last {recentDays} days{item.earlierCount > 0 ? `, ${item.earlierCount}× before` : ', not bought before'}
        </div>
      </div>
      <span className="tag tag-accent shrink-0 tabular-nums">{item.factor == null ? 'New' : `${item.factor}× as often`}</span>
      <HideButton name={item.name} onHide={onHide} />
    </li>
  )
}

function Fading({ item, onHide }: { item: FadingItem; onHide?: () => void }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-chip text-text/60" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 7l10 10M17 9v8H9" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{item.name}</div>
        <div className="text-xs text-text/60">
          Bought {item.earlierCount}×, last on {day(item.lastBought)}
        </div>
      </div>
      <span className="tag tag-neutral shrink-0 tabular-nums">{item.weeksSince < 1 ? 'this week' : `${item.weeksSince} wk ago`}</span>
      <HideButton name={item.name} onHide={onHide} />
    </li>
  )
}

function Thumb({ id, version }: { id: string; version: number }) {
  return (
    <span
      aria-hidden="true"
      className="h-9 w-9 shrink-0 rounded-[9px] bg-accent-800 bg-cover bg-center"
      style={version > 0 ? { backgroundImage: `url(${recipePhotoUrl(id, version)})` } : undefined}
    />
  )
}

// Link to the recipe on screen; plain text in the exported picture.
function RecipeName({ id, name, link }: { id: string; name: string; link: boolean }) {
  return link ? (
    <Link to={`/recipes?open=${id}`} className="font-semibold text-text no-underline hover:underline">
      {name}
    </Link>
  ) : (
    <span className="font-semibold">{name}</span>
  )
}

function PopularMeals({ meals, link }: { meals: TrendRecipe[]; link: boolean }) {
  const max = Math.max(...meals.map((m) => m.timesPlanned), 1)
  return (
    <ol className="m-0 grid list-none gap-2.5 p-0">
      {meals.map((meal) => (
        <li key={meal.recipeId} className="flex items-center gap-2.5">
          <Thumb id={meal.recipeId} version={meal.photoVersion} />
          <div className="grid min-w-0 flex-1 gap-1">
            <div className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <RecipeName id={meal.recipeId} name={meal.name} link={link} />
              </span>
              <span className="shrink-0 text-[13px] text-text/70 tabular-nums">{meal.timesPlanned}×</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-chip" aria-hidden="true">
              <div className="h-full rounded-full" style={{ width: `${Math.max((meal.timesPlanned / max) * 100, 3)}%`, background: 'var(--chart-1)' }} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function QuietMeal({ meal, link, onHide }: { meal: QuietRecipe; link: boolean; onHide?: () => void }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <Thumb id={meal.recipeId} version={meal.photoVersion} />
      <div className="min-w-0 flex-1">
        <div className="truncate">
          <RecipeName id={meal.recipeId} name={meal.name} link={link} />
        </div>
        <div className="text-xs text-text/60">
          Planned {meal.earlierCount}×, last on {day(meal.lastPlanned)}
        </div>
      </div>
      <span className="tag tag-neutral shrink-0 tabular-nums">{meal.weeksSince < 1 ? 'this week' : `${meal.weeksSince} wk ago`}</span>
      <HideButton name={meal.name} onHide={onHide} />
    </li>
  )
}

function Categories({ categories }: { categories: CategorySpend[] }) {
  const total = categories.reduce((sum, c) => sum + c.spent, 0)
  const top = categories.slice(0, 4)
  const rest = categories.slice(4)
  const restSpent = rest.reduce((sum, c) => sum + c.spent, 0)
  const rows = [...top.map((c, i) => ({ name: c.category, spent: c.spent, color: CHART_VARS[i] })), ...(rest.length ? [{ name: `${rest.length} more`, spent: restSpent, color: 'var(--color-text)' }] : [])]
  if (total <= 0) return <Empty>No purchases in this period.</Empty>
  return (
    <div className="grid gap-3">
      <div className="flex h-3.5 overflow-hidden rounded-full bg-chip" role="img" aria-label={`Spending by category: ${rows.map((r) => `${r.name} ${money(r.spent)}`).join(', ')}`}>
        {rows.map((r) => (
          <div key={r.name} style={{ width: `${(r.spent / total) * 100}%`, background: r.color, opacity: r.name.endsWith('more') ? 0.3 : 1 }} />
        ))}
      </div>
      <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color, opacity: r.name.endsWith('more') ? 0.3 : 1 }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="text-text/60 tabular-nums">{Math.round((r.spent / total) * 100)}%</span>
            <span className="w-20 text-right font-semibold tabular-nums">{money(r.spent)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-[14px] border border-divider bg-bg px-3.5 py-3">
      <div className="card-kicker text-text/60">{label}</div>
      <div className="mt-1 font-heading text-[24px] leading-none font-bold tabular-nums">{value}</div>
      {note && <div className={`mt-1.5 text-xs ${tone === 'up' ? 'text-danger' : tone === 'down' ? 'text-accent-200' : 'text-text/60'}`}>{note}</div>}
    </div>
  )
}

// The whole analysis as one card. It is drawn the same on screen and in the exported
// image; `wide` pins the two-column layout and drops the buttons for the export copy.
export const TrendsInfographic = forwardRef<HTMLDivElement, Props>(function TrendsInfographic(
  { trends, profileName, hidden = new Set(), onHide, wide = false },
  ref,
) {
  const rising = trends.rising.filter((r) => !hidden.has(r.itemId))
  const fading = trends.fading.filter((f) => !hidden.has(f.itemId))
  const quietMeals = (trends.quietRecipes ?? []).filter((m) => !hidden.has(m.recipeId))
  const days = daysBetween(trends.from, trends.to)
  const recentDays = daysBetween(trends.recentFrom, trends.to)
  const perTrip = trends.tripCount > 0 ? trends.spent / trends.tripCount : 0

  let spendNote: string | undefined
  let spendTone: 'up' | 'down' | undefined
  if (trends.previousSpent != null && trends.previousSpent > 0) {
    const pct = Math.round(((trends.spent - trends.previousSpent) / trends.previousSpent) * 100)
    spendNote = pct === 0 ? `same as ${RANGE_NAME[trends.range]}` : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% vs ${RANGE_NAME[trends.range]}`
    spendTone = pct > 0 ? 'up' : pct < 0 ? 'down' : undefined
  }

  const cols = wide ? 'grid-cols-2' : 'grid-cols-[minmax(0,1fr)] sm:grid-cols-2'
  return (
    <div
      ref={ref}
      className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-[20px] bg-surface p-4 text-text sm:p-6"
      style={wide ? { width: 800, padding: 28 } : undefined}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <div className="card-kicker">Shopping trends{profileName ? ` · ${profileName}` : ''}</div>
          <h2 className="m-0 mt-0.5 text-[24px] sm:text-[28px]">
            {dayYear(trends.from)} – {dayYear(trends.to)}
          </h2>
        </div>
        <div className="text-xs text-text/60">
          {days} days · "lately" is the last {recentDays}
        </div>
      </header>

      <div className={`grid gap-3 ${wide ? 'grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'}`}>
        <Stat label="Trips" value={String(trends.tripCount)} note={trends.previousTripCount != null ? `${trends.previousTripCount} before` : undefined} />
        <Stat label="Spent" value={money(trends.spent)} note={spendNote} tone={spendTone} />
        <Stat label="Different items" value={String(trends.itemCount)} />
        <Stat label="Per trip" value={money(perTrip)} />
      </div>

      {!trends.enoughData && (
        <p className="m-0 rounded-[14px] bg-chip px-3.5 py-2.5 text-sm text-text/80">
          {trends.tripCount === 0
            ? 'No bought items in this period yet.'
            : `Only ${trends.tripCount} ${trends.tripCount === 1 ? 'trip' : 'trips'} in this period — trends get more reliable with at least 4. Try a longer range.`}
        </p>
      )}

      <div className={`grid gap-4 ${cols}`}>
        <Section title="Most bought" hint="Trips each item was on">
          {trends.mostBought.length ? (
            <BarList items={trends.mostBought} value={(i) => i.timesBought} label={(i) => `${i.timesBought}×`} color="var(--chart-1)" />
          ) : (
            <Empty>Nothing bought yet.</Empty>
          )}
        </Section>
        <Section title="Biggest spend" hint="Total paid in the period">
          {trends.biggestSpend.length ? (
            <BarList items={trends.biggestSpend} value={(i) => i.spent} label={(i) => money(i.spent)} color="var(--chart-2)" />
          ) : (
            <Empty>Nothing bought yet.</Empty>
          )}
        </Section>
        <Section title="Buying more lately" hint={`Last ${recentDays} days compared with the ${days - recentDays} before`}>
          {rising.length ? (
            <ul className="m-0 grid list-none gap-3 p-0">
              {rising.map((r) => (
                <Rising key={r.itemId} item={r} recentDays={recentDays} onHide={onHide && !wide ? () => onHide(r.itemId) : undefined} />
              ))}
            </ul>
          ) : (
            <Empty>{trends.enoughData ? 'Nothing stands out — your habits are steady.' : 'Needs a few more trips to tell.'}</Empty>
          )}
        </Section>
        <Section title="Gone quiet" hint={`Bought 3+ times earlier, not once in the last ${recentDays} days`}>
          {fading.length ? (
            <ul className="m-0 grid list-none gap-3 p-0">
              {fading.map((f) => (
                <Fading key={f.itemId} item={f} onHide={onHide && !wide ? () => onHide(f.itemId) : undefined} />
              ))}
            </ul>
          ) : (
            <Empty>{trends.enoughData ? 'Everything you regularly buy is still in your cart.' : 'Needs a few more trips to tell.'}</Empty>
          )}
        </Section>
      </div>

      {trends.popularRecipes && trends.quietRecipes && (
        <div className={`grid gap-4 ${cols}`}>
          <Section title="Popular meals" hint="Trips each recipe was planned on">
            {trends.popularRecipes.length ? (
              <PopularMeals meals={trends.popularRecipes} link={!wide} />
            ) : (
              <Empty>No meals planned in this period — add a recipe to a trip.</Empty>
            )}
          </Section>
          <Section title="Meals gone quiet" hint={`Planned 2+ times earlier, not once in the last ${recentDays} days`}>
            {quietMeals.length ? (
              <ul className="m-0 grid list-none gap-3 p-0">
                {quietMeals.map((m) => (
                  <QuietMeal key={m.recipeId} meal={m} link={!wide} onHide={onHide && !wide ? () => onHide(m.recipeId) : undefined} />
                ))}
              </ul>
            ) : (
              <Empty>{trends.enoughData ? 'Every meal you plan is still in rotation.' : 'Needs a few more trips to tell.'}</Empty>
            )}
          </Section>
        </div>
      )}

      <Section title="Where the money goes" hint="Spend by category">
        <Categories categories={trends.categories} />
      </Section>

      <footer className="text-[11px] text-text/50">
        Counts are trips an item was bought on. "Gone quiet" is a guess from what's missing — it may just be out of season or bought elsewhere.
      </footer>
    </div>
  )
})

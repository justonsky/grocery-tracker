import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { TripStatus } from '../api/types'
import { MonthlySpendChart } from '../components/MonthlySpendChart'
import { TrackedItemsGrid } from '../components/TrackedItemsGrid'
import { useOutstandingEntityIds } from '../offline/useOutstandingIds'
import { summarizeByStore } from '../trips/costSummary'
import { localIsoDate } from '../dates'

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const greetingFor = (hour: number) => (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening')
const tripDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
const STATUS_LABEL: Record<TripStatus, string> = { planned: 'Planned', shopping: 'Shopping', done: 'Done' }

function SpendCard({ kicker, total, count, className = '' }: { kicker: string; total: number; count: number; className?: string }) {
  return (
    <div className={`card elev-sm gap-1.5 px-5 py-4 sm:px-[22px] sm:py-5 ${className}`}>
      <div className="card-kicker text-text/60">{kicker}</div>
      <div className="font-heading text-[30px] leading-none font-bold tracking-tight tabular-nums sm:text-[34px]">{money(total)}</div>
      <div className="card-meta text-[13px]">{plural(count, 'trip')}</div>
    </div>
  )
}

// Money left of this month's trip budgets; red once it's overspent. Only shown
// when a trip this month has a budget.
function BudgetCard({ budget, spent }: { budget: number; spent: number }) {
  const left = budget - spent
  const over = left < 0
  return (
    <div className="card elev-sm gap-1.5 px-5 py-4 sm:px-[22px] sm:py-5">
      <div className="card-kicker text-text/60">{over ? 'Over budget' : 'Budget left'}</div>
      <div
        className={`font-heading text-[30px] leading-none font-bold tracking-tight tabular-nums sm:text-[34px] ${over ? 'text-danger' : 'text-accent-200'}`}
      >
        {over ? `-${money(-left)}` : money(left)}
      </div>
      <div className="card-meta text-[13px]">of {money(budget)} this month</div>
    </div>
  )
}

export function Dashboard({ profileId }: { profileId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', profileId],
    queryFn: () => api.dashboard(profileId),
  })
  const { data: profiles } = useQuery({ queryKey: ['profiles'], queryFn: api.profiles.list })
  const profileName = profiles?.find((p) => p.id === profileId)?.name

  const recentTripId = data?.recentTrip?.id
  // The dashboard summary doesn't carry the trip's status or stores; the full trip does.
  const { data: tripDetail, isPending: detailPending } = useQuery({
    queryKey: ['trip', profileId, recentTripId],
    queryFn: () => api.trips(profileId).get(recentTripId!),
    enabled: Boolean(recentTripId),
  })

  const pendingTripIds = useOutstandingEntityIds('trip')

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
        <div className="skel h-20" />
      </div>
    )
  }

  const now = new Date()
  const today = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const recent = data.recentTrip
  const hasBudget = data.monthBudget != null
  const hasSpendHistory = data.monthlySpend.some((m) => m.total > 0)
  const upNext = tripDetail?.status === 'planned'
  // A planned list dated before today wasn't shopped on its day: still to do, not "up next".
  const overdue = upNext && recent != null && recent.date < localIsoDate(now)
  const storeGroups = upNext
    ? summarizeByStore(
        tripDetail.items.map((it) => ({ storeName: it.storeName, estimate: it.estimate, price: it.price })),
        tripDetail.stores,
      )
    : []

  return (
    <div className="mx-auto grid max-w-[1100px] gap-6 px-4 py-6 pb-15 sm:gap-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] text-text/70">{today}</div>
          <h1 className="m-0 mt-1 line-clamp-2 text-[28px] leading-tight break-words sm:text-[40px]">
            {greetingFor(now.getHours())}
            {profileName ? `, ${profileName}` : ''}
          </h1>
        </div>
        <Link to="/trips/new" className="btn btn-primary min-h-12 px-5 text-[15px]">
          + New list
        </Link>
      </div>

      <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${hasBudget ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        <SpendCard kicker="Today" total={data.todaySpend} count={data.todayCount} />
        <SpendCard kicker="This month" total={data.monthSpend} count={data.monthCount} />
        <SpendCard
          kicker="This year"
          total={data.yearSpend}
          count={data.yearCount}
          className={hasBudget ? '' : 'col-span-2 sm:col-span-1'}
        />
        {hasBudget && <BudgetCard budget={data.monthBudget!} spent={data.monthBudgetSpent} />}
      </div>

      {recent ? (
        <section aria-labelledby="recent-trip" className="card elev-sm gap-3.5 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="recent-trip" className="m-0 text-[22px]">
              {upNext ? (overdue ? 'Still to shop' : 'Up next') : 'Latest trip'}
            </h2>
            <span className="tag tag-neutral">
              {tripDetail ? `${overdue ? 'Planned for' : `${STATUS_LABEL[tripDetail.status]} ·`} ${tripDate(recent.date)}` : tripDate(recent.date)}
            </span>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="grid min-w-0 gap-0.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-[15px] font-semibold">
                <span className="min-w-0 break-words">{recent.name || recent.storeName}</span>
                {pendingTripIds.has(recent.id) && <span className="tag tag-neutral text-[10px]">Pending sync</span>}
              </div>
              <div className="text-xs text-text/70">{plural(recent.itemCount, 'item')}</div>
            </div>
            <div className="shrink-0 font-heading text-xl leading-none font-bold tabular-nums">
              {upNext && tripDetail ? `est. ${money(tripDetail.estimatedTotal)}` : money(recent.total)}
            </div>
          </div>

          {upNext ? (
            <div className="grid gap-2.5">
              {storeGroups.map((g, i) => (
                <div
                  key={g.storeName ?? 'any'}
                  className={`flex items-center gap-3 rounded-[14px] px-3.5 py-3 text-text ${i % 2 === 0 ? 'bg-accent-800' : 'bg-chip'}`}
                >
                  <span className="min-w-0 flex-1 text-sm font-bold break-words">{g.storeName ?? 'Any store'}</span>
                  <span className="shrink-0 text-[13px] text-text/80">{plural(g.lineCount, 'item')}</span>
                  <span className="shrink-0 text-sm font-bold tabular-nums">{g.estimatedCount > 0 ? money(g.estimated) : '—'}</span>
                </div>
              ))}
            </div>
          ) : detailPending ? (
            <div className="skel h-24" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <tbody>
                  {recent.items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.itemName}</td>
                      <td>
                        <span className="tag tag-neutral">{it.categoryName}</span>
                      </td>
                      <td className="text-right font-semibold">
                        {it.price != null ? money(it.price) : <span className="text-text/40">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-1 flex flex-wrap gap-2.5">
            {upNext && (
              <Link to={`/trips/${recent.id}`} className="btn btn-highlight">
                Open list
              </Link>
            )}
            <Link to={`/trips/${recent.id}`} className="btn btn-secondary">
              Edit trip
            </Link>
          </div>
        </section>
      ) : (
        <section className="card elev-sm items-center gap-2.5 px-8 py-8 text-center">
          <p className="m-0 mb-2.5 text-text/70">No trips yet. Plan a list, then tick things off as you shop.</p>
          <Link to="/trips/new" className="btn btn-primary">
            Start a shopping list
          </Link>
        </section>
      )}

      {hasSpendHistory && (
        <section aria-labelledby="monthly-spend" className="card elev-sm gap-3 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="monthly-spend" className="m-0 text-[22px]">
              Spending by month
            </h2>
            <Link to="/trends" className="inline-flex min-h-11 items-center text-sm font-semibold">
              See shopping trends →
            </Link>
          </div>
          <MonthlySpendChart months={data.monthlySpend} />
        </section>
      )}

      <TrackedItemsGrid profileId={profileId} dashboard={data} />
    </div>
  )
}

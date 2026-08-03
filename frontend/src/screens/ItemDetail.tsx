import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

const money = (n: number) => `$${n.toFixed(2)}`

function LineChart({ points }: { points: { date: string; price: number }[] }) {
  if (points.length < 2) {
    return (
      <svg width="100%" height="220" viewBox="0 0 640 220">
        <text x={320} y={110} textAnchor="middle" fill="var(--color-text)" opacity={0.5} fontSize={13}>
          Not enough purchases yet for a trend line
        </text>
      </svg>
    )
  }
  const prices = points.map((p) => p.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const step = 640 / (points.length - 1)
  const coords = points.map((p, i) => [i * step, 200 - ((p.price - min) / range) * 180] as const)
  const d = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ')
  return (
    <svg width="100%" height="220" viewBox="0 0 640 220" preserveAspectRatio="none">
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
    </svg>
  )
}

export function ItemDetail({ profileId }: { profileId: string }) {
  const { itemId } = useParams()
  const navigate = useNavigate()

  const { data: history, isLoading } = useQuery({
    queryKey: ['item-history', profileId, itemId],
    queryFn: () => api.items(profileId).history(itemId!),
  })

  if (isLoading || !history) {
    return (
      <div className="mx-auto max-w-[820px] px-5 pt-6 pb-15">
        <div className="skel h-8 w-40" />
      </div>
    )
  }

  const ascendingForChart = [...history.history].reverse()

  return (
    <div className="mx-auto max-w-[820px] px-5 pt-6 pb-15">
      <div className="mb-1.5 flex items-center gap-2.5">
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Back" onClick={() => navigate(-1)}>
          ←
        </button>
        <h3 className="m-0">{history.itemName}</h3>
        <span className="tag tag-outline">{history.categoryName}</span>
      </div>

      <div className="card elev-sm mt-3.5">
        <LineChart points={ascendingForChart} />
      </div>

      <div className="my-4.5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <div className="card elev-sm">
          <div className="card-kicker">Current</div>
          <div className="card-title">{money(history.current)}</div>
        </div>
        <div className="card elev-sm">
          <div className="card-kicker">Lowest</div>
          <div className="card-title">{money(history.lowest)}</div>
          <div className="card-meta">{history.lowestMeta}</div>
        </div>
        <div className="card elev-sm">
          <div className="card-kicker">Highest</div>
          <div className="card-title">{money(history.highest)}</div>
          <div className="card-meta">{history.highestMeta}</div>
        </div>
        <div className="card elev-sm">
          <div className="card-kicker">Avg overall</div>
          <div className="card-title">{money(history.average)}</div>
        </div>
      </div>

      <h4 className="mb-2">Purchase history</h4>
      <div className="card elev-sm p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Store</th>
              <th className="text-right">Price</th>
              <th className="text-right">Change</th>
            </tr>
          </thead>
          <tbody>
            {history.history.map((h, i) => (
              <tr key={i}>
                <td>{h.date}</td>
                <td>{h.storeName}</td>
                <td className="text-right">{money(h.price)}</td>
                <td
                  className="text-right"
                  style={{
                    color:
                      h.deltaFromPrevious == null
                        ? undefined
                        : h.deltaFromPrevious > 0
                          ? 'var(--color-danger)'
                          : 'var(--color-accent)',
                  }}
                >
                  {h.deltaFromPrevious == null
                    ? '—'
                    : `${h.deltaFromPrevious > 0 ? '+' : ''}${money(h.deltaFromPrevious)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

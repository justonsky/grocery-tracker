import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { toPng } from 'html-to-image'
import { api } from '../api/client'
import type { TrendsRange } from '../api/types'
import { TrendsInfographic } from '../components/TrendsInfographic'
import { useToast } from '../components/ui/ToastProvider'

const RANGES: { id: TrendsRange; label: string }[] = [
  { id: '30d', label: '30 days' },
  { id: '90d', label: '3 months' },
  { id: '180d', label: '6 months' },
  { id: '365d', label: '1 year' },
  { id: 'all', label: 'All time' },
]
const RANGE_KEY = 'grocery-tracker-trends-range'
const hiddenKey = (profileId: string) => `grocery-tracker-trends-hidden:${profileId}`

function loadRange(): TrendsRange {
  try {
    const saved = localStorage.getItem(RANGE_KEY)
    if (RANGES.some((r) => r.id === saved)) return saved as TrendsRange
  } catch {
    // storage unavailable: fall through to the default
  }
  return '90d'
}

// Items hidden from the "buying more" / "gone quiet" lists, remembered on this device.
function useHiddenItems(profileId: string) {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(hiddenKey(profileId)) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const save = useCallback(
    (next: Set<string>) => {
      setHidden(next)
      try {
        localStorage.setItem(hiddenKey(profileId), JSON.stringify([...next]))
      } catch {
        // not remembered, still hidden for this visit
      }
    },
    [profileId],
  )
  return {
    hidden,
    hide: (id: string) => save(new Set(hidden).add(id)),
    restore: () => save(new Set()),
  }
}

export function Trends({ profileId }: { profileId: string }) {
  const toast = useToast()
  const [range, setRange] = useState<TrendsRange>(loadRange)
  const { hidden, hide, restore } = useHiddenItems(profileId)
  const { data: profiles } = useQuery({ queryKey: ['profiles'], queryFn: api.profiles.list })
  const profileName = profiles?.find((p) => p.id === profileId)?.name

  const { data: trends, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['trends', profileId, range],
    queryFn: () => api.trends(profileId, range),
    // Fresh numbers each visit; the cached copy only fills the gap while it loads (or offline).
    staleTime: 0,
  })

  const pickRange = (next: TrendsRange) => {
    setRange(next)
    try {
      localStorage.setItem(RANGE_KEY, next)
    } catch {
      // the choice just isn't remembered
    }
  }

  // The export is a fixed-width copy rendered only while saving, so the on-screen layout
  // (which flexes to the window) never changes what ends up in the image.
  const [exporting, setExporting] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!exporting) return
    let cancelled = false
    const run = async () => {
      // two frames: let the copy mount and lay out before it is rasterised
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      try {
        if (!exportRef.current) throw new Error('not rendered')
        const dataUrl = await toPng(exportRef.current, { pixelRatio: 2 })
        if (cancelled) return
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = `shopping-trends-${trends?.from}-to-${trends?.to}.png`
        a.click()
      } catch {
        if (!cancelled) toast('error', "Couldn't export the trends as an image.")
      } finally {
        if (!cancelled) setExporting(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [exporting]) // eslint-disable-line react-hooks/exhaustive-deps

  const hiddenHere = trends ? [...trends.rising, ...trends.fading].filter((i) => hidden.has(i.itemId)).length : 0

  return (
    <div className="mx-auto grid max-w-[1100px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-6 pb-15 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <Link to="/" className="btn btn-ghost btn-icon -ml-2 text-text" aria-label="Back to home">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="m-0 text-[28px] leading-tight sm:text-[36px]">Shopping trends</h1>
          <p className="m-0 mt-1 text-sm text-text/70">What you buy most, what's picking up, and what has dropped off.</p>
        </div>
        <button type="button" className="btn btn-secondary" disabled={!trends || exporting} onClick={() => setExporting(true)}>
          {exporting ? 'Saving…' : 'Export image'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="seg max-w-full flex-wrap" role="radiogroup" aria-label="Period">
          {RANGES.map((r) => (
            <label key={r.id} className="seg-opt min-h-11">
              <input type="radio" name="trends-range" checked={range === r.id} onChange={() => pickRange(r.id)} />
              {r.label}
            </label>
          ))}
        </div>
        {isFetching && trends && <span className="text-xs text-text/60">Updating…</span>}
        {hiddenHere > 0 && (
          <button type="button" className="btn btn-ghost btn-sm text-text/70" onClick={restore}>
            Show {hiddenHere} hidden {hiddenHere === 1 ? 'item' : 'items'}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4" aria-busy="true" aria-label="Analysing your trips">
          <div className="skel h-28" />
          <div className="skel h-64" />
        </div>
      ) : isError || !trends ? (
        <div className="card elev-sm items-center gap-3 px-6 py-8 text-center">
          <p className="m-0 text-text/70">Couldn't run the analysis. Trends need your home server — check you're connected and try again.</p>
          <button type="button" className="btn btn-primary" onClick={() => refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <TrendsInfographic trends={trends} profileName={profileName} hidden={hidden} onHide={hide} />
          {exporting && (
            <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0 }}>
              <TrendsInfographic ref={exportRef} trends={trends} profileName={profileName} hidden={hidden} wide />
            </div>
          )}
        </>
      )}
    </div>
  )
}

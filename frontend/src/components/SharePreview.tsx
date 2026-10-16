import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toJpeg, toPng } from 'html-to-image'
import { api } from '../api/client'
import type { Settings } from '../api/types'
import { PRESET_COLORS, buildGroups, resolveGroupColors, type GroupBy, type ShareItem } from '../trips/shareGroups'
import { ShareableListCard } from './ShareableListCard'
import { useToast } from './ui/ToastProvider'

const GROUP_BY_KEY = 'grocery-tracker-share-group-by'
const GROUP_OPTIONS: { id: GroupBy; label: string }[] = [
  { id: 'category', label: 'Category' },
  { id: 'store', label: 'Store' },
  { id: 'none', label: 'No groups' },
]

// Per-device convenience, so it survives a blocked or cleared localStorage.
function readGroupBy(): GroupBy {
  try {
    const saved = localStorage.getItem(GROUP_BY_KEY)
    return saved === 'store' || saved === 'none' ? saved : 'category'
  } catch {
    return 'category'
  }
}

const DownloadIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
  </svg>
)

// "Preview & share": choose how the list is grouped, color each group, and
// export the card as an image. Colors are a household setting (the same list
// looks the same from every device); the grouping choice is per device.
export function SharePreview({
  name,
  date,
  items,
  stores,
  estimatedCostLabel,
}: {
  name: string
  date: string
  items: ShareItem[]
  stores: string[]
  estimatedCostLabel: string | null
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const cardRef = useRef<HTMLDivElement>(null)
  const [groupBy, setGroupByState] = useState<GroupBy>(readGroupBy)
  const [editing, setEditing] = useState<string | null>(null)
  // A custom color being dragged: shown at once, saved once the dragging stops.
  const [draft, setDraft] = useState<{ key: string; value: string } | null>(null)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })
  const picked = useMemo(() => settings?.groupColors ?? {}, [settings?.groupColors])

  const groups = useMemo(() => buildGroups(items, groupBy, stores), [items, groupBy, stores])
  const shown = useMemo(() => (draft ? { ...picked, [draft.key]: draft.value } : picked), [picked, draft])
  const colors = useMemo(() => resolveGroupColors(groups, groupBy, shown), [groups, groupBy, shown])

  const setGroupBy = (next: GroupBy) => {
    setGroupByState(next)
    setEditing(null)
    try {
      localStorage.setItem(GROUP_BY_KEY, next)
    } catch {
      // Not remembered on this device; still applies now.
    }
  }

  const saveColors = useMutation({
    mutationFn: (groupColors: Record<string, string>) => api.settings.update({ groupColors }),
    onMutate: (groupColors) => {
      const previous = queryClient.getQueryData<Settings>(['settings'])
      queryClient.setQueryData<Settings>(['settings'], (old) => (old ? { ...old, groupColors } : old))
      return { previous }
    },
    onError: (_error, _vars, context) => {
      queryClient.setQueryData(['settings'], context?.previous)
      toast('error', "Couldn't save that color — colors need a connection to your home server.")
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  // value: a hex color, "none" for no fill, or null to go back to the default.
  const setColor = (key: string, value: string | null) => {
    if (draftTimer.current) clearTimeout(draftTimer.current)
    setDraft(null)
    const next = { ...picked }
    if (value === null) delete next[key]
    else next[key] = value
    saveColors.mutate(next)
  }

  const exportImage = async (format: 'png' | 'jpeg') => {
    if (!cardRef.current) return
    try {
      const dataUrl = format === 'png' ? await toPng(cardRef.current) : await toJpeg(cardRef.current, { quality: 0.95 })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${(name || 'grocery-trip').toLowerCase().replace(/\s+/g, '-')}.${format === 'jpeg' ? 'jpg' : 'png'}`
      a.click()
    } catch {
      toast('error', "Couldn't export this list as an image.")
    }
  }

  const editingGroup = groups.find((g) => g.key === editing)
  const editingColor = editing ? (colors.get(editing) ?? null) : null

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="m-0 text-lg">Preview &amp; share</h4>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => exportImage('png')}>
            <DownloadIcon />
            Export PNG
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => exportImage('jpeg')}>
            <DownloadIcon />
            Export JPG
          </button>
        </div>
      </div>

      <div className="mb-3 grid gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-text/70" id="share-group-by">
            Group by
          </span>
          <div className="seg" role="radiogroup" aria-labelledby="share-group-by">
            {GROUP_OPTIONS.map((o) => (
              <label key={o.id} className="seg-opt max-sm:min-h-11">
                <input type="radio" name="share-group-by" checked={groupBy === o.id} onChange={() => setGroupBy(o.id)} />
                {o.label}
              </label>
            ))}
          </div>
        </div>

        {groupBy !== 'none' && groups.length > 0 && (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Group colors">
              <span className="mr-0.5 text-xs font-semibold text-text/70">Colors</span>
              {groups.map((g) => {
                const fill = colors.get(g.key) ?? null
                return (
                  <button
                    key={g.key}
                    type="button"
                    aria-expanded={editing === g.key}
                    aria-label={`Color for ${g.label}`}
                    onClick={() => setEditing((k) => (k === g.key ? null : g.key))}
                    className={`flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border bg-surface px-3 py-1 text-[13px] font-medium text-text sm:min-h-9 ${
                      editing === g.key ? 'border-accent shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'border-divider hover:border-text/45'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 rounded-full border border-divider"
                      style={
                        fill
                          ? { background: fill }
                          : { background: 'repeating-linear-gradient(45deg, transparent 0 3px, var(--color-divider) 3px 5px)' }
                      }
                    />
                    <span className="max-w-[10rem] truncate">{g.label}</span>
                  </button>
                )
              })}
            </div>

            {editingGroup && (
              <div className="card gap-3 border border-divider elev-sm" role="dialog" aria-label={`Color for ${editingGroup.label}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">
                    Color for <strong>{editingGroup.label}</strong>
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm max-sm:min-h-11" onClick={() => setEditing(null)}>
                    Done
                  </button>
                </div>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Preset colors">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      role="radio"
                      aria-checked={editingColor === c.value}
                      aria-label={c.name}
                      title={c.name}
                      onClick={() => setColor(editingGroup.key, c.value)}
                      className={`h-11 w-11 cursor-pointer rounded-full border sm:h-9 sm:w-9 ${
                        editingColor === c.value ? 'border-accent shadow-[0_0_0_2px_var(--color-accent)]' : 'border-divider'
                      }`}
                      style={{ background: c.value }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-control bg-surface px-2.5 text-[13px] font-semibold sm:min-h-9">
                    <input
                      type="color"
                      aria-label="Custom color"
                      className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0"
                      value={editingColor ?? '#ffffff'}
                      onChange={(e) => {
                        const key = editingGroup.key
                        const value = e.target.value
                        setDraft({ key, value })
                        if (draftTimer.current) clearTimeout(draftTimer.current)
                        draftTimer.current = setTimeout(() => setColor(key, value), 600)
                      }}
                    />
                    Custom
                  </label>
                  <button type="button" className="btn btn-secondary btn-sm max-sm:min-h-11" onClick={() => setColor(editingGroup.key, 'none')}>
                    No color
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm max-sm:min-h-11" onClick={() => setColor(editingGroup.key, null)}>
                    Reset to default
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* The card is fixed-width for a consistent image export; on a phone it
          scrolls inside this box rather than widening the whole page. */}
      <div className="max-w-full overflow-x-auto rounded-[18px] bg-chip p-3 sm:p-4">
        <div className="mx-auto w-fit">
        <ShareableListCard
          ref={cardRef}
          name={name || date}
          date={date}
          groups={groups}
          groupBy={groupBy}
          colors={colors}
          estimatedCostLabel={estimatedCostLabel}
        />
        </div>
      </div>
    </div>
  )
}

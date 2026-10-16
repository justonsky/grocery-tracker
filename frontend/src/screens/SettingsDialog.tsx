import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Category, ChartScheme, Profile } from '../api/types'
import { Dialog } from '../components/ui/Dialog'
import { useToast } from '../components/ui/ToastProvider'
import { performOrQueue, newClientId } from '../offline/performOrQueue'
import { timeAgo } from '../offline/timeAgo'
import { useConnectivity } from '../app/ConnectivityProvider'
import { useSync } from '../app/SyncProvider'
import type { SettingsState } from '../app/settingsLink'
import { CHART_SCHEMES, THEMES, themeOf } from '../app/themes'

export function SettingsDialog({ profileId }: { profileId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [newCategoryName, setNewCategoryName] = useState('')
  const [includeItems, setIncludeItems] = useState(false)
  const exportHref = `/api/v1/export/data.xlsx${includeItems ? '?includeItems=true' : ''}`

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories.list })
  const { data: profiles } = useQuery({ queryKey: ['profiles'], queryFn: api.profiles.list })
  const profile = profiles?.find((p) => p.id === profileId)
  const { status } = useConnectivity()
  const { lastSyncAt, pendingCount } = useSync()
  const canExport = status === 'online'

  // Back to the page underneath; if settings was opened with nothing behind it, to the dashboard.
  const close = () => ((location.state as SettingsState | null)?.background ? navigate(-1) : navigate('/', { replace: true }))

  // Theme is deliberately NOT routed through the offline outbox — it's a
  // household-global setting (AppSettings.ThemeMode), and queuing an offline
  // toggle would flip everyone's theme once it synced, not just this device's.
  const setTheme = useMutation({
    mutationFn: (themeMode: 'system' | 'light' | 'dark') => api.settings.update({ themeMode }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  // Chart colors are household-wide too, and online-only for the same reason.
  const setChartScheme = useMutation({
    mutationFn: (chartScheme: ChartScheme) => api.settings.update({ chartScheme }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
    onError: () => toast('error', "Couldn't change the chart colors."),
  })

  // Unlike light/dark, the color theme belongs to the profile, so it goes
  // through the outbox like any other profile edit and applies immediately.
  const setProfileTheme = useMutation({
    networkMode: 'always',
    mutationFn: (theme: string) => {
      const name = profile!.name
      queryClient.setQueryData<Profile[]>(['profiles'], (old) => old?.map((p) => (p.id === profileId ? { ...p, theme } : p)))
      return performOrQueue(() => api.profiles.upsert(profileId, name, theme), {
        entity: 'profile',
        action: 'put',
        entityId: profileId,
        profileId: null,
        isCreate: false,
        payload: { name, theme },
        label: `Theme for "${name}"`,
      })
    },
    onSuccess: (outcome) => {
      if (outcome.sent) queryClient.invalidateQueries({ queryKey: ['profiles'] })
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] })
      toast('error', "Couldn't change the theme.")
    },
  })

  const addCategory = useMutation({
    // Without this, TanStack Query pauses the mutation entirely while
    // onlineManager reports offline — performOrQueue's own fallback-to-queue
    // logic would never get a chance to run.
    networkMode: 'always',
    mutationFn: async (name: string) => {
      const id = newClientId()
      const outcome = await performOrQueue(() => api.categories.upsert(id, name), {
        entity: 'category',
        action: 'put',
        entityId: id,
        profileId: null,
        isCreate: true,
        payload: { name },
        label: `Category "${name}"`,
      })
      return { id, name, outcome }
    },
    onSuccess: ({ id, name, outcome }) => {
      if (outcome.sent) {
        queryClient.invalidateQueries({ queryKey: ['categories'] })
      } else {
        // Splice it in locally so it's selectable in the trip editor right
        // away — skip invalidate, which would otherwise refetch the old list
        // and wipe this back out before the create has actually synced.
        queryClient.setQueryData<Category[]>(['categories'], (old) => [
          ...(old ?? []),
          { id, name, isBuiltIn: false, sortOrder: (old?.length ?? 0) + 1 },
        ])
        toast('success', "Saved on this device — will sync when you're back online.")
      }
      setNewCategoryName('')
    },
    onError: () => toast('error', 'That category already exists.'),
  })

  const removeCategory = useMutation({
    networkMode: 'always',
    mutationFn: (id: string) =>
      performOrQueue(() => api.categories.delete(id), {
        entity: 'category',
        action: 'delete',
        entityId: id,
        profileId: null,
        isCreate: false,
        payload: null,
        label: 'Delete category',
      }),
    onSuccess: (outcome, id) => {
      queryClient.setQueryData<Category[]>(['categories'], (old) => old?.filter((c) => c.id !== id))
      if (outcome.sent) {
        queryClient.invalidateQueries({ queryKey: ['categories'] })
      } else {
        toast('success', "Delete saved — will sync when you're back online.")
      }
    },
    onError: () => toast('error', "Couldn't remove that category."),
  })

  const themeMode = settings?.themeMode ?? 'system'
  const chartScheme = settings?.chartScheme ?? 'fresh'

  return (
    <Dialog title="Settings" onClose={close}>
      <section className="field rounded-[14px] border border-divider bg-bg p-3.5">
        <label>Appearance</label>
        <div className="seg max-w-full" role="radiogroup">
          {(['system', 'light', 'dark'] as const).map((mode) => (
            <label key={mode} className="seg-opt min-h-11">
              <input type="radio" name="theme" checked={themeMode === mode} onChange={() => setTheme.mutate(mode)} />
              {mode[0].toUpperCase() + mode.slice(1)}
            </label>
          ))}
        </div>
      </section>

      <section className="field rounded-[14px] border border-divider bg-bg p-3.5">
        <label>Chart colors</label>
        <div className="seg flex w-full" role="radiogroup" aria-label="Chart colors">
          {CHART_SCHEMES.map((c) => (
            <label key={c.id} className="seg-opt min-h-11 flex-1 flex-col justify-center gap-1 px-2 py-1.5">
              <input type="radio" name="chart-scheme" checked={chartScheme === c.id} onChange={() => setChartScheme.mutate(c.id)} />
              {/* A scoped data-chart gives each option its own palette for the swatch. */}
              <span className="flex gap-0.5" aria-hidden="true" data-chart={c.id}>
                {[1, 2, 3].map((n) => (
                  <span key={n} className="h-3.5 w-3.5 rounded-full" style={{ background: `var(--chart-${n})` }} />
                ))}
              </span>
              {c.name}
            </label>
          ))}
        </div>
        <p className="m-0 mt-2 text-xs text-text/70">Used by the price charts and the monthly spending chart.</p>
      </section>

      {profile && (
        <section className="field rounded-[14px] border border-divider bg-bg p-3.5">
          <label>Color theme for {profile.name}</label>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2" role="radiogroup" aria-label="Color theme">
            {THEMES.map((t) => {
              const selected = themeOf(profile.theme) === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-theme={t.id}
                  onClick={() => !selected && setProfileTheme.mutate(t.id)}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border bg-surface px-2.5 py-1.5 text-left text-xs font-semibold text-text ${
                    selected ? 'border-accent shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'border-divider hover:border-text/45'
                  }`}
                >
                  <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full bg-accent">
                    <span className="absolute inset-y-0 right-0 w-1/2 bg-accent-2" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {selected && (
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      )}

      <section className="field rounded-[14px] border border-divider bg-bg p-3.5">
        <label>Categories</label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {categories?.map((c) => (
            <span key={c.id} className="tag tag-neutral min-h-11 gap-1 border border-divider bg-surface pr-1.5 pl-3.5 text-text">
              {c.name}
              {!c.isBuiltIn && (
                <button
                  type="button"
                  aria-label={`Remove ${c.name}`}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 text-text/60 hover:bg-danger-bg hover:text-danger"
                  onClick={() => removeCategory.mutate(c.id)}
                >
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="Add a category"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && newCategoryName.trim() && addCategory.mutate(newCategoryName.trim())}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!newCategoryName.trim()}
            onClick={() => addCategory.mutate(newCategoryName.trim())}
          >
            Add
          </button>
        </div>
      </section>

      <section className="field rounded-[14px] border border-divider bg-bg p-3.5">
        <label>Backup</label>
        {canExport ? (
          <a href={exportHref} download className="btn btn-primary btn-block mt-0">
            Download my data (.xlsx)
          </a>
        ) : (
          <button type="button" className="btn btn-primary btn-block mt-0" disabled title="Reconnect to your home server to export.">
            Download my data (.xlsx)
          </button>
        )}
        <label className="mt-1 mb-0 flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-normal text-text">
          <input type="checkbox" className="h-5 w-5 accent-accent" checked={includeItems} onChange={(e) => setIncludeItems(e.target.checked)} />
          Include the item catalogue (separate sheet)
        </label>
        <p className="m-0 text-xs text-text/60">Profiles, trips with their totals and savings, and every trip item.</p>
        {!canExport && <p className="mt-1 mb-0 text-xs text-danger">Can't reach your home server — try again once you're back online.</p>}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="m-0 text-xs text-text/60">
          {pendingCount > 0
            ? `${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} waiting to sync.`
            : lastSyncAt
              ? `Last synced ${timeAgo(lastSyncAt)}.`
              : 'Not synced yet on this device.'}
        </p>
        <button type="button" className="btn btn-secondary" onClick={close}>
          Close
        </button>
      </div>
    </Dialog>
  )
}

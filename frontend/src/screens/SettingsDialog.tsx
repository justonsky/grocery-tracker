import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Category, Profile } from '../api/types'
import { Dialog } from '../components/ui/Dialog'
import { useToast } from '../components/ui/ToastProvider'
import { performOrQueue, newClientId } from '../offline/performOrQueue'
import { timeAgo } from '../offline/timeAgo'
import { useConnectivity } from '../app/ConnectivityProvider'
import { useSync } from '../app/SyncProvider'
import { THEMES, themeOf } from '../app/themes'

export function SettingsDialog({ profileId }: { profileId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [newCategoryName, setNewCategoryName] = useState('')

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories.list })
  const { data: profiles } = useQuery({ queryKey: ['profiles'], queryFn: api.profiles.list })
  const profile = profiles?.find((p) => p.id === profileId)
  const { status } = useConnectivity()
  const { lastSyncAt, pendingCount } = useSync()
  const canExport = status === 'online'

  const close = () => navigate(-1)

  // Theme is deliberately NOT routed through the offline outbox — it's a
  // household-global setting (AppSettings.ThemeMode), and queuing an offline
  // toggle would flip everyone's theme once it synced, not just this device's.
  const setTheme = useMutation({
    mutationFn: (themeMode: 'system' | 'light' | 'dark') => api.settings.update({ themeMode }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
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

  return (
    <Dialog title="Settings" onClose={close}>
      <div className="field">
        <label>Appearance</label>
        <div className="seg" role="radiogroup">
          {(['system', 'light', 'dark'] as const).map((mode) => (
            <label key={mode} className="seg-opt">
              <input type="radio" name="theme" checked={themeMode === mode} onChange={() => setTheme.mutate(mode)} />
              {mode[0].toUpperCase() + mode.slice(1)}
            </label>
          ))}
        </div>
      </div>

      {profile && (
        <div className="field">
          <label>Color theme for {profile.name}</label>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-1.5" role="radiogroup" aria-label="Color theme">
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
                  className={`flex cursor-pointer items-center gap-2 rounded-md border bg-surface px-2 py-1.5 text-left text-xs text-text ${
                    selected ? 'border-accent shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'border-divider hover:border-text/45'
                  }`}
                >
                  <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded-full bg-accent">
                    <span className="absolute inset-y-0 right-0 w-1/2 bg-accent-2" />
                  </span>
                  {t.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="field">
        <label>Categories</label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {categories?.map((c) => (
            <span key={c.id} className="tag tag-neutral flex items-center gap-1.5">
              {c.name}
              {!c.isBuiltIn && (
                <button
                  type="button"
                  className="cursor-pointer border-none bg-transparent p-0 text-xs"
                  onClick={() => removeCategory.mutate(c.id)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
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
      </div>

      <div className="field">
        <label>Backup</label>
        {canExport ? (
          <a href="/api/v1/export/data.xlsx" download className="btn btn-primary btn-block">
            Download my data (.xlsx)
          </a>
        ) : (
          <button type="button" className="btn btn-primary btn-block" disabled title="Reconnect to your home server to export.">
            Download my data (.xlsx)
          </button>
        )}
        {!canExport && <p className="mt-1 text-xs text-text/60">Can't reach your home server — try again once you're back online.</p>}
      </div>

      <p className="text-xs text-text/50">
        {pendingCount > 0
          ? `${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} waiting to sync.`
          : lastSyncAt
            ? `Last synced ${timeAgo(lastSyncAt)}.`
            : 'Not synced yet on this device.'}
      </p>

      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={close}>
          Close
        </button>
      </div>
    </Dialog>
  )
}

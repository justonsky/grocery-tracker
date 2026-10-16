import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Profile } from '../api/types'
import { Avatar } from '../app/AppShell'
import { DEFAULT_THEME, themeOf, useDocumentTheme } from '../app/themes'
import { useToast } from '../components/ui/ToastProvider'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { performOrQueue, newClientId } from '../offline/performOrQueue'

export function ProfilePicker({ onSelect }: { onSelect: (profileId: string) => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const { data: profiles, isLoading } = useQuery({ queryKey: ['profiles'], queryFn: api.profiles.list })
  // Nobody is signed in here, so the page itself uses the default theme; each
  // profile card below carries its own.
  useDocumentTheme(DEFAULT_THEME)

  const createProfile = useMutation({
    // Without this, TanStack Query pauses the mutation entirely while
    // onlineManager reports offline — performOrQueue's own fallback-to-queue
    // logic would never get a chance to run.
    networkMode: 'always',
    mutationFn: async (name: string) => {
      const id = newClientId()
      const outcome = await performOrQueue(() => api.profiles.upsert(id, name), {
        entity: 'profile',
        action: 'put',
        entityId: id,
        profileId: null,
        isCreate: true,
        payload: { name },
        label: `Profile "${name}"`,
      })
      return { id, name, outcome }
    },
    onSuccess: ({ id, name, outcome }) => {
      if (outcome.sent) {
        queryClient.invalidateQueries({ queryKey: ['profiles'] })
      } else {
        // Not sent to the server yet — splice it in locally so it's
        // selectable right away. Skipping invalidate here matters: a refetch
        // would return the old (pre-create) list and silently wipe this back out.
        queryClient.setQueryData<Profile[]>(['profiles'], (old) => [
          ...(old ?? []),
          { id, name, createdAt: new Date().toISOString(), tripCount: 0, theme: DEFAULT_THEME },
        ])
        toast('success', "Saved on this device — will sync when you're back online.")
      }
      setCreating(false)
      setNewName('')
      onSelect(id)
    },
    onError: () => toast('error', "Couldn't create that profile."),
  })

  const deleteProfile = useMutation({
    networkMode: 'always',
    mutationFn: (id: string) =>
      performOrQueue(() => api.profiles.delete(id), {
        entity: 'profile',
        action: 'delete',
        entityId: id,
        profileId: null,
        isCreate: false,
        payload: null,
        label: 'Delete profile',
      }),
    onSuccess: (outcome, id) => {
      queryClient.setQueryData<Profile[]>(['profiles'], (old) => old?.filter((p) => p.id !== id))
      if (outcome.sent) {
        queryClient.invalidateQueries({ queryKey: ['profiles'] })
      } else {
        toast('success', "Delete saved — will sync when you're back online.")
      }
    },
    onError: () => toast('error', "Couldn't delete that profile."),
  })

  const askDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Delete ${name}?`,
      body: 'This permanently deletes their trips on every device. Items stay, but their purchases stop counting toward the household price averages.',
    })
    if (ok) deleteProfile.mutate(id)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-bg px-5 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <img src="/favicon.svg" alt="" className="h-14 w-14 rounded-[16px]" />
        <h1 className="m-0 text-[clamp(28px,4vw,38px)] leading-tight">Grocery Tracker</h1>
        <p className="m-0 text-text/70">Who's shopping today?</p>
      </div>
      <div className="flex w-full max-w-[760px] flex-wrap justify-center gap-4">
        {!isLoading &&
          profiles?.map((p) => (
            <div
              key={p.id}
              data-theme={themeOf(p.theme)}
              className="card elev-sm relative w-[calc(50%-0.5rem)] cursor-pointer items-center gap-0 px-3 pt-7 pb-5 text-center transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md sm:w-[168px]"
              onClick={() => onSelect(p.id)}
            >
              <button
                type="button"
                aria-label="Delete profile"
                className="btn btn-ghost btn-icon absolute top-1 right-1 text-text/55 hover:bg-danger-bg hover:text-danger"
                onClick={(e) => {
                  e.stopPropagation()
                  askDelete(p.id, p.name)
                }}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
              <div className="mb-3">
                <Avatar name={p.name} size={72} />
              </div>
              <div className="max-w-full truncate font-heading text-base font-bold">{p.name}</div>
              <span className="tag tag-neutral mt-2 px-2.5 py-0.5 font-semibold">
                {p.tripCount} {p.tripCount === 1 ? 'trip' : 'trips'}
              </span>
            </div>
          ))}

        {creating ? (
          <div className="card elev-sm w-[calc(50%-0.5rem)] items-center justify-center gap-2 px-3 py-5 sm:w-[168px]">
            <input
              className="input text-center"
              placeholder="Name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newName.trim() && createProfile.mutate(newName.trim())}
            />
            <div className="flex gap-1.5">
              <button type="button" className="btn btn-secondary px-3" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary px-3"
                disabled={!newName.trim()}
                onClick={() => createProfile.mutate(newName.trim())}
              >
                Add
              </button>
            </div>
          </div>
        ) : (
          <div
            className="flex min-h-[188px] w-[calc(50%-0.5rem)] cursor-pointer flex-col items-center justify-center gap-2 rounded-[18px] border-2 border-dashed border-control bg-transparent px-3 py-5 text-center text-accent transition-colors hover:border-accent hover:bg-accent/5 sm:w-[168px]"
            onClick={() => setCreating(true)}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-800 text-accent-200">
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <div className="text-sm font-semibold">Add profile</div>
          </div>
        )}
      </div>
    </div>
  )
}

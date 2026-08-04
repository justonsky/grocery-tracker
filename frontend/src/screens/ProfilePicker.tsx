import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Profile } from '../api/types'
import { Avatar } from '../app/AppShell'
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
          { id, name, createdAt: new Date().toISOString(), tripCount: 0 },
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
      body: 'This permanently deletes their trips, lists, and price history on this device.',
    })
    if (ok) deleteProfile.mutate(id)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-7 px-5 py-8">
      <div className="text-center">
        <h1 className="text-[clamp(28px,4vw,38px)]">Grocery Tracker</h1>
        <p className="m-0 text-text/70">Who's shopping today?</p>
      </div>
      <div className="flex max-w-[720px] flex-wrap justify-center gap-4.5">
        {!isLoading &&
          profiles?.map((p) => (
            <div
              key={p.id}
              className="card elev-sm relative w-[150px] cursor-pointer items-center px-3.5 py-5.5 text-center transition-transform hover:-translate-y-0.5 hover:shadow-md"
              onClick={() => onSelect(p.id)}
            >
              <button
                type="button"
                aria-label="Delete profile"
                className="btn btn-ghost btn-icon absolute top-1.5 right-1.5 h-6.5 w-6.5"
                style={{ color: 'var(--color-danger)' }}
                onClick={(e) => {
                  e.stopPropagation()
                  askDelete(p.id, p.name)
                }}
              >
                ×
              </button>
              <div className="mb-2.5">
                <Avatar name={p.name} size={56} />
              </div>
              <div className="font-heading text-[15px]">{p.name}</div>
              <div className="mt-0.5 text-[11px] text-text/70">
                {p.tripCount} {p.tripCount === 1 ? 'trip' : 'trips'}
              </div>
            </div>
          ))}

        {creating ? (
          <div className="card elev-sm w-[150px] items-center gap-2 px-3.5 py-5.5">
            <input
              className="input text-center text-[13px]"
              placeholder="Name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newName.trim() && createProfile.mutate(newName.trim())}
            />
            <div className="flex gap-1.5">
              <button type="button" className="btn btn-secondary px-2.5 py-1 text-xs" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary px-2.5 py-1 text-xs"
                disabled={!newName.trim()}
                onClick={() => createProfile.mutate(newName.trim())}
              >
                Add
              </button>
            </div>
          </div>
        ) : (
          <div
            className="card elev-sm w-[150px] cursor-pointer items-center justify-center gap-2 border border-dashed border-divider bg-transparent px-3.5 py-5.5 text-center"
            onClick={() => setCreating(true)}
          >
            <span className="text-2xl text-accent">+</span>
            <div className="text-[13px] text-accent">Add profile</div>
          </div>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { Avatar } from '../app/AppShell'
import { useToast } from '../components/ui/ToastProvider'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { useOnlineStatus } from '../app/useOnlineStatus'

export function ProfilePicker() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const isOnline = useOnlineStatus()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const { data: profiles, isLoading } = useQuery({ queryKey: ['profiles'], queryFn: api.profiles.list })

  const selectProfile = useMutation({
    mutationFn: (profileId: string) => api.settings.update({ currentProfileId: profileId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const createProfile = useMutation({
    mutationFn: (name: string) => api.profiles.create(name),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] })
      setCreating(false)
      setNewName('')
      selectProfile.mutate(profile.id)
    },
    onError: () => toast('error', "Couldn't create that profile."),
  })

  const deleteProfile = useMutation({
    mutationFn: (id: string) => api.profiles.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profiles'] }),
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
      {!isOnline && (
        <div
          className="max-w-[420px] rounded-md px-4 py-2 text-center text-xs"
          style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}
        >
          Can't reach your local server. Profile selection needs a connection — check your network and try again.
        </div>
      )}
      <div className="flex max-w-[720px] flex-wrap justify-center gap-4.5">
        {!isLoading &&
          profiles?.map((p) => (
            <div
              key={p.id}
              className={`card elev-sm relative w-[150px] items-center px-3.5 py-5.5 text-center transition-transform ${
                isOnline ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md' : 'cursor-not-allowed opacity-60'
              }`}
              onClick={() => isOnline && selectProfile.mutate(p.id)}
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
                disabled={!newName.trim() || !isOnline}
                onClick={() => createProfile.mutate(newName.trim())}
              >
                Add
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`card elev-sm w-[150px] items-center justify-center gap-2 border border-dashed border-divider bg-transparent px-3.5 py-5.5 text-center ${
              isOnline ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
            }`}
            onClick={() => isOnline && setCreating(true)}
          >
            <span className="text-2xl text-accent">+</span>
            <div className="text-[13px] text-accent">Add profile</div>
          </div>
        )}
      </div>
    </div>
  )
}

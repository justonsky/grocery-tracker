import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { GroceryList } from '../api/types'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { useToast } from '../components/ui/ToastProvider'
import { performOrQueue } from '../offline/performOrQueue'
import { useOutstandingEntityIds } from '../offline/useOutstandingIds'

export function ListsIndex({ profileId }: { profileId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const toast = useToast()

  const { data: lists, isLoading } = useQuery({ queryKey: ['lists', profileId], queryFn: () => api.lists(profileId).list() })
  const pendingListIds = useOutstandingEntityIds('list')

  const del = useMutation({
    networkMode: 'always',
    mutationFn: (listId: string) =>
      performOrQueue(() => api.lists(profileId).delete(listId), {
        entity: 'list',
        action: 'delete',
        entityId: listId,
        profileId,
        isCreate: false,
        payload: null,
        label: 'Delete list',
      }),
    onSuccess: (outcome, listId) => {
      // Remove it from view immediately either way — staying visible after
      // the user just deleted it would be confusing even though it's
      // technically still true until the delete syncs.
      queryClient.setQueryData<GroceryList[]>(['lists', profileId], (old) => old?.filter((l) => l.id !== listId))
      if (outcome.sent) {
        queryClient.invalidateQueries({ queryKey: ['lists', profileId] })
        toast('success', 'List deleted.')
      } else {
        toast('success', "Delete saved — will sync when you're back online.")
      }
    },
    onError: () => toast('error', "Couldn't delete that list."),
  })

  const askDelete = async (listId: string, name: string) => {
    const ok = await confirm({ title: `Delete "${name}"?` })
    if (ok) del.mutate(listId)
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[900px] px-5 pt-6 pb-15">
        <div className="skel mb-4 h-6 w-32" />
        <div className="skel h-24" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[900px] px-5 pt-6 pb-15">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0">Grocery lists</h3>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/lists/new')}>
          + New list
        </button>
      </div>

      {lists?.length === 0 && (
        <div className="card elev-sm items-center gap-2.5 px-8 py-8 text-center">
          <p className="m-0 mb-2.5 text-text/70">No grocery lists yet.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/lists/new')}>
            Create your first list
          </button>
        </div>
      )}

      <div className="grid gap-3">
        {lists?.map((list) => {
          const checkedCount = list.items.filter((i) => i.checked).length
          return (
            <Link
              to={`/lists/${list.id}`}
              key={list.id}
              className="card elev-sm flex-row items-center justify-between gap-3 no-underline transition-transform hover:-translate-y-0.5 hover:shadow-md"
            >
              <div>
                <div className="card-title flex items-center gap-1.5 text-[15px]">
                  {list.name}
                  {pendingListIds.has(list.id) && <span className="tag tag-neutral text-[10px]">Pending sync</span>}
                </div>
                <div className="card-meta">
                  {checkedCount}/{list.items.length} checked
                  {list.date ? ` · ${list.date}` : ''}
                </div>
              </div>
              <button
                type="button"
                aria-label="Delete list"
                className="btn btn-ghost btn-icon"
                style={{ color: 'var(--color-danger)' }}
                onClick={(e) => {
                  e.preventDefault()
                  askDelete(list.id, list.name)
                }}
              >
                ×
              </button>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

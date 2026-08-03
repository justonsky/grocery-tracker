import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { useToast } from '../components/ui/ToastProvider'

export function ListsIndex({ profileId }: { profileId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const toast = useToast()

  const { data: lists, isLoading } = useQuery({ queryKey: ['lists', profileId], queryFn: () => api.lists(profileId).list() })

  const del = useMutation({
    mutationFn: (listId: string) => api.lists(profileId).delete(listId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lists', profileId] })
      toast('success', 'List deleted.')
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
                <div className="card-title text-[15px]">{list.name}</div>
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

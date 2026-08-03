import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { TripItemInput } from '../api/types'
import { useToast } from '../components/ui/ToastProvider'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { useOnlineStatus } from '../app/useOnlineStatus'

const todayIso = () => new Date().toISOString().slice(0, 10)

interface DraftRow extends TripItemInput {
  key: string
}
const newRow = (categoryId: string): DraftRow => ({
  key: Math.random().toString(36).slice(2, 9),
  itemName: '',
  categoryId,
  price: 0,
})

export function TripEditor({ profileId }: { profileId: string }) {
  const { tripId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const isOnline = useOnlineStatus()
  const isEditing = Boolean(tripId)

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories.list })
  const { data: existingTrip } = useQuery({
    queryKey: ['trip', profileId, tripId],
    queryFn: () => api.trips(profileId).get(tripId!),
    enabled: isEditing,
  })

  const [date, setDate] = useState(todayIso())
  const [store, setStore] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([])

  useEffect(() => {
    if (existingTrip) {
      setDate(existingTrip.date)
      setStore(existingTrip.storeName)
      setRows(
        existingTrip.items.map((it) => ({
          key: it.id,
          itemName: it.itemName,
          categoryId: it.categoryId,
          price: it.price,
        })),
      )
    } else if (categories && rows.length === 0 && !isEditing) {
      setRows([newRow(categories[0]?.id ?? '')])
    }
  }, [existingTrip, categories, isEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  const defaultCategoryId = categories?.[0]?.id ?? ''
  const total = rows.reduce((sum, r) => sum + (Number.isFinite(r.price) ? r.price : 0), 0)

  const save = useMutation({
    mutationFn: () => {
      const items = rows.filter((r) => r.itemName.trim()).map(({ key: _key, ...rest }) => rest)
      const input = { date, storeName: store.trim(), items }
      return isEditing ? api.trips(profileId).update(tripId!, input) : api.trips(profileId).create(input)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', profileId] })
      queryClient.invalidateQueries({ queryKey: ['trips', profileId] })
      toast('success', isEditing ? 'Trip updated.' : 'Trip logged.')
      navigate('/')
    },
    onError: () => toast('error', "Couldn't save this trip."),
  })

  const del = useMutation({
    mutationFn: () => api.trips(profileId).delete(tripId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', profileId] })
      queryClient.invalidateQueries({ queryKey: ['trips', profileId] })
      toast('success', 'Trip deleted.')
      navigate('/')
    },
  })

  const askDelete = async () => {
    const ok = await confirm({ title: 'Delete this trip?', body: 'This cannot be undone.' })
    if (ok) del.mutate()
  }

  const updateRow = (key: string, patch: Partial<DraftRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const removeRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key))
  const addRow = () => setRows((rs) => [...rs, newRow(defaultCategoryId)])

  return (
    <div className="mx-auto max-w-[760px] px-5 pt-6 pb-25">
      <div className="mb-4.5 flex items-center gap-2.5">
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Back" onClick={() => navigate(-1)}>
          ←
        </button>
        <h3 className="m-0">{isEditing ? 'Edit trip' : 'Log a trip'}</h3>
        {isEditing && (
          <button
            type="button"
            className="btn btn-ghost ml-auto"
            style={{ color: 'var(--color-danger)' }}
            onClick={askDelete}
          >
            Delete trip
          </button>
        )}
      </div>

      <div className="card elev-sm gap-4">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div className="field">
            <label>Date</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Store</label>
            <input
              className="input"
              placeholder="e.g. Trader Joe's"
              value={store}
              onChange={(e) => setStore(e.target.value)}
            />
          </div>
        </div>

        <div className="hr" />

        <div className="grid gap-2.5">
          {rows.map((row) => (
            <div key={row.key} className="grid grid-cols-[1.5fr_1fr_0.8fr_auto] items-center gap-2">
              <input
                className="input"
                placeholder="Item name"
                value={row.itemName}
                onChange={(e) => updateRow(row.key, { itemName: e.target.value })}
              />
              <select
                className="input"
                value={row.categoryId}
                onChange={(e) => updateRow(row.key, { categoryId: e.target.value })}
              >
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={row.price || ''}
                onChange={(e) => updateRow(row.key, { price: parseFloat(e.target.value) || 0 })}
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                aria-label="Remove item"
                onClick={() => removeRow(row.key)}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost justify-self-start" onClick={addRow}>
            + Add item
          </button>
        </div>

        <div className="hr" />

        <div className="flex items-center justify-between">
          <div className="text-sm text-text/70">Trip total</div>
          <div className="font-heading text-[22px]">${total.toFixed(2)}</div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!store.trim() || save.isPending || !isOnline}
            title={isOnline ? undefined : "Can't save while offline"}
            onClick={() => save.mutate()}
          >
            Save trip
          </button>
        </div>
      </div>
    </div>
  )
}

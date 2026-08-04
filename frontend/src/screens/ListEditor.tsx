import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toJpeg, toPng } from 'html-to-image'
import { api } from '../api/client'
import type { GroceryListInput, ListItemInput } from '../api/types'
import { useToast } from '../components/ui/ToastProvider'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { ShareableListCard } from '../components/ShareableListCard'
import { performOrQueue, newClientId } from '../offline/performOrQueue'

const todayIso = () => new Date().toISOString().slice(0, 10)

interface DraftItem extends ListItemInput {
  key: string
}
const newItem = (categoryId: string): DraftItem => ({
  key: Math.random().toString(36).slice(2, 9),
  itemName: '',
  categoryId,
  preferredStoreName: null,
  checked: false,
})

export function ListEditor({ profileId }: { profileId: string }) {
  const { listId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const isEditing = Boolean(listId)

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories.list })
  const { data: existingList } = useQuery({
    queryKey: ['list', profileId, listId],
    queryFn: () => api.lists(profileId).get(listId!),
    enabled: isEditing,
  })
  // Full item/store lists back native <datalist> autocomplete below — small
  // enough per profile that fetching once beats debouncing per keystroke.
  const { data: itemSuggestions } = useQuery({ queryKey: ['items', profileId], queryFn: () => api.items(profileId).search() })
  const { data: storeSuggestions } = useQuery({ queryKey: ['stores', profileId], queryFn: () => api.stores(profileId).search() })

  const [name, setName] = useState(`Grocery List — ${todayIso()}`)
  const [date, setDate] = useState(todayIso())
  const [stores, setStores] = useState<string[]>([])
  const [newStoreName, setNewStoreName] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])

  useEffect(() => {
    if (existingList) {
      setName(existingList.name)
      setDate(existingList.date ?? '')
      setStores(existingList.stores)
      setItems(
        existingList.items.map((it) => ({
          key: it.id,
          itemName: it.itemName,
          categoryId: it.categoryId,
          preferredStoreName: it.preferredStoreName,
          checked: it.checked,
        })),
      )
    } else if (categories && items.length === 0 && !isEditing) {
      setItems([newItem(categories[0]?.id ?? '')])
    }
  }, [existingList, categories, isEditing]) // eslint-disable-line react-hooks/exhaustive-deps

  const defaultCategoryId = categories?.[0]?.id ?? ''

  const save = useMutation({
    // See TripEditor's save — without this, useMutation pauses entirely while
    // offline instead of ever reaching performOrQueue's own fallback logic.
    networkMode: 'always',
    mutationFn: async () => {
      const cleanItems = items.filter((r) => r.itemName.trim()).map(({ key: _key, ...rest }) => rest)
      const input: GroceryListInput = { name: name.trim() || 'Grocery List', date: date || null, stores, items: cleanItems }
      const id = isEditing ? listId! : newClientId()

      return performOrQueue(() => api.lists(profileId).upsert(id, input), {
        entity: 'list',
        action: 'put',
        entityId: id,
        profileId,
        isCreate: !isEditing,
        payload: input,
        dependsOn: Array.from(new Set(cleanItems.map((i) => i.categoryId))),
        label: `List "${input.name}"`,
      })
    },
    onSuccess: (outcome) => {
      queryClient.invalidateQueries({ queryKey: ['lists', profileId] })
      queryClient.invalidateQueries({ queryKey: ['items', profileId] })
      queryClient.invalidateQueries({ queryKey: ['stores', profileId] })
      toast(
        'success',
        outcome.sent
          ? isEditing
            ? 'List updated.'
            : 'List created.'
          : "Saved on this device — will sync when you're back online.",
      )
      navigate('/lists')
    },
    onError: () => toast('error', "Couldn't save this list."),
  })

  const del = useMutation({
    networkMode: 'always',
    mutationFn: () =>
      performOrQueue(() => api.lists(profileId).delete(listId!), {
        entity: 'list',
        action: 'delete',
        entityId: listId!,
        profileId,
        isCreate: false,
        payload: null,
        label: `Delete list "${name}"`,
      }),
    onSuccess: (outcome) => {
      queryClient.invalidateQueries({ queryKey: ['lists', profileId] })
      toast('success', outcome.sent ? 'List deleted.' : "Delete saved — will sync when you're back online.")
      navigate('/lists')
    },
    onError: () => toast('error', "Couldn't delete this list."),
  })

  const askDelete = async () => {
    const ok = await confirm({ title: 'Delete this list?' })
    if (ok) del.mutate()
  }

  const addStore = () => {
    const trimmed = newStoreName.trim()
    if (!trimmed || stores.some((s) => s.toLowerCase() === trimmed.toLowerCase())) return
    setStores((s) => [...s, trimmed])
    setNewStoreName('')
  }
  const removeStore = (name: string) => {
    setStores((s) => s.filter((x) => x !== name))
    setItems((its) => its.map((it) => (it.preferredStoreName === name ? { ...it, preferredStoreName: null } : it)))
  }

  const updateItem = (key: string, patch: Partial<DraftItem>) =>
    setItems((its) => its.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  const removeItem = (key: string) => setItems((its) => its.filter((it) => it.key !== key))
  const addItem = () => setItems((its) => [...its, newItem(defaultCategoryId)])

  // See TripEditor's setItemName — same "carry over the remembered category
  // when a datalist suggestion is picked" behavior.
  const setItemName = (key: string, value: string) => {
    const match = itemSuggestions?.find((i) => i.name.toLowerCase() === value.toLowerCase())
    updateItem(key, match?.defaultCategoryId ? { itemName: value, categoryId: match.defaultCategoryId } : { itemName: value })
  }

  const previewRef = useRef<HTMLDivElement>(null)
  const categoryName = (id: string) => categories?.find((c) => c.id === id)?.name ?? 'Other'
  const previewItems = items
    .filter((it) => it.itemName.trim())
    .map((it) => ({
      itemName: it.itemName,
      categoryName: categoryName(it.categoryId),
      preferredStoreName: it.preferredStoreName,
      checked: it.checked,
    }))
  const hasPreview = previewItems.length > 0

  const exportImage = async (format: 'png' | 'jpeg') => {
    if (!previewRef.current) return
    try {
      const dataUrl =
        format === 'png' ? await toPng(previewRef.current) : await toJpeg(previewRef.current, { quality: 0.95 })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${(name || 'grocery-list').toLowerCase().replace(/\s+/g, '-')}.${format === 'jpeg' ? 'jpg' : 'png'}`
      a.click()
    } catch {
      toast('error', "Couldn't export this list as an image.")
    }
  }

  return (
    <div className="mx-auto max-w-[760px] px-5 pt-6 pb-25">
      <div className="mb-4.5 flex items-center gap-2.5">
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Back" onClick={() => navigate('/lists')}>
          ←
        </button>
        <h3 className="m-0">{isEditing ? 'Edit list' : 'New list'}</h3>
        {isEditing && (
          <button type="button" className="btn btn-ghost ml-auto" style={{ color: 'var(--color-danger)' }} onClick={askDelete}>
            Delete list
          </button>
        )}
      </div>

      <div className="card elev-sm gap-4">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-[2fr_1fr]">
          <div className="field">
            <label>List name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Planned for</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>Stores you plan to visit</label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {stores.map((s) => (
              <span key={s} className="tag tag-neutral flex items-center gap-1.5">
                {s}
                <button type="button" className="cursor-pointer border-none bg-transparent p-0 text-xs" onClick={() => removeStore(s)}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              className="input"
              list="dl-stores"
              placeholder="e.g. Costco"
              value={newStoreName}
              onChange={(e) => setNewStoreName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addStore()}
            />
            <button type="button" className="btn btn-secondary" onClick={addStore}>
              Add store
            </button>
          </div>
        </div>
        <datalist id="dl-stores">
          {storeSuggestions?.map((s) => <option key={s.id} value={s.name} />)}
        </datalist>
        <datalist id="dl-items">
          {itemSuggestions?.map((i) => <option key={i.id} value={i.name} />)}
        </datalist>

        <div className="hr" />

        <div className="grid gap-2.5">
          {items.map((item) => (
            <div key={item.key} className="grid grid-cols-[auto_1.4fr_1fr_1fr_auto] items-center gap-2">
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) => updateItem(item.key, { checked: e.target.checked })}
                className="h-4.5 w-4.5 accent-accent"
              />
              <input
                className="input"
                list="dl-items"
                placeholder="Item name"
                value={item.itemName}
                onChange={(e) => setItemName(item.key, e.target.value)}
              />
              <select className="input" value={item.categoryId} onChange={(e) => updateItem(item.key, { categoryId: e.target.value })}>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={item.preferredStoreName ?? ''}
                onChange={(e) => updateItem(item.key, { preferredStoreName: e.target.value || null })}
              >
                <option value="">Any store</option>
                {stores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove item" onClick={() => removeItem(item.key)}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost justify-self-start" onClick={addItem}>
            + Add item
          </button>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/lists')}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            Save list
          </button>
        </div>
      </div>

      {hasPreview && (
        <div className="mt-5.5">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="m-0">Preview &amp; share</h4>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => exportImage('png')}>
                Export PNG
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => exportImage('jpeg')}>
                Export JPG
              </button>
            </div>
          </div>
          <ShareableListCard ref={previewRef} name={name} date={date} items={previewItems} />
        </div>
      )}
    </div>
  )
}

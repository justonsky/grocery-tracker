import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { Category, Recipe } from '../../api/types'
import { useUnsavedChangesGuard } from '../../app/useUnsavedChangesGuard'
import { newClientId } from '../../offline/performOrQueue'
import { Combobox, type ComboOption } from '../ui/Combobox'
import { Dialog } from '../ui/Dialog'
import { useToast } from '../ui/ToastProvider'
import { recipePhotoUrl } from '../../recipes'
import { CAMERA, CLOSE, RecipeIcon } from './icons'
import { usePhotoPicker } from './usePhotoPicker'

interface Row {
  key: string
  itemName: string
  categoryId: string | null
  categoryName: string
  amount: string
}

const NAME_MAX = 120
const DESCRIPTION_MAX = 2000
const normalize = (s: string) => s.trim().toLowerCase()

// Create or edit a recipe. A photo chosen here is held until Save (cropped first if it is
// over the limits), then uploaded with the recipe.
export function RecipeForm({ recipe, onClose, onSaved }: { recipe?: Recipe; onClose: () => void; onSaved: (recipe: Recipe) => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data: catalogue } = useQuery({ queryKey: ['items'], queryFn: () => api.items.search() })
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories.list })

  const [name, setName] = useState(recipe?.name ?? '')
  const [description, setDescription] = useState(recipe?.description ?? '')
  const [rows, setRows] = useState<Row[]>(
    () => recipe?.items.map((i) => ({ key: i.itemId, itemName: i.itemName, categoryId: i.categoryId, categoryName: i.categoryName, amount: i.amount ?? '' })) ?? [],
  )
  const [draft, setDraft] = useState('')
  const [draftCategory, setDraftCategory] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const picker = usePhotoPicker((blob) => {
    setPhoto(blob)
    setRemovePhoto(false)
  })
  useEffect(() => {
    if (!photo) return setPreview(null)
    const url = URL.createObjectURL(photo)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const initial = useMemo(() => JSON.stringify([recipe?.name ?? '', recipe?.description ?? '', recipe?.items.map((i) => [i.itemName, i.amount ?? '']) ?? []]), [recipe])
  const current = JSON.stringify([name, description, rows.map((r) => [r.itemName, r.amount])])
  const dirty = current !== initial || photo !== null || removePhoto
  const [saved, setSaved] = useState(false)
  useUnsavedChangesGuard(() => dirty && !saved)

  const options: ComboOption[] = useMemo(
    () => (catalogue ?? []).filter((i) => !rows.some((r) => normalize(r.itemName) === normalize(i.name))).map((i) => ({ value: i.name, label: i.name, hint: i.averagePrice != null ? `avg $${i.averagePrice.toFixed(2)}` : undefined })),
    [catalogue, rows],
  )
  const known = (catalogue ?? []).find((i) => normalize(i.name) === normalize(draft))
  const categoryOf = (id: string | null | undefined): Category | undefined => categories?.find((c) => c.id === id)

  const addDraft = (text = draft) => {
    const itemName = text.trim()
    if (!itemName || rows.some((r) => normalize(r.itemName) === normalize(itemName))) return
    const match = (catalogue ?? []).find((i) => normalize(i.name) === normalize(itemName))
    const categoryId = match?.defaultCategoryId ?? (draftCategory || categories?.[0]?.id || null)
    setRows((rs) => [...rs, { key: newClientId(), itemName: match?.name ?? itemName, categoryId, categoryName: categoryOf(categoryId)?.name ?? 'Other', amount: '' }])
    setDraft('')
  }

  const save = useMutation({
    mutationFn: async () => {
      const id = recipe?.id ?? newClientId()
      let saved = await api.recipes.upsert(id, {
        name: name.trim(),
        description: description.trim() || null,
        items: rows.map((r) => ({ itemName: r.itemName, categoryId: r.categoryId, amount: r.amount.trim() || null })),
      })
      // The recipe is saved; a photo that then fails is reported but doesn't undo it.
      let photoFailed = false
      try {
        if (photo) saved = await api.recipes.setPhoto(id, photo)
        else if (removePhoto && recipe && recipe.photoVersion > 0) saved = await api.recipes.removePhoto(id)
      } catch {
        photoFailed = true
      }
      return { saved, photoFailed }
    },
    onSuccess: ({ saved, photoFailed }) => {
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: ['recipes'] })
      void queryClient.invalidateQueries({ queryKey: ['items'] })
      toast(photoFailed ? 'error' : 'success', photoFailed ? "Recipe saved, but the photo couldn't be uploaded. Try changing the photo again." : 'Recipe saved.')
      onSaved(saved)
    },
    onError: () => setError("Couldn't save this recipe. Check you're connected to your home server and try again."),
  })

  const submit = () => {
    setError(null)
    if (!name.trim()) return setError('Give the recipe a name.')
    if (rows.length === 0) return setError('Add at least one item.')
    save.mutate()
  }

  const shownPhoto = preview ?? (!removePhoto && recipe && recipe.photoVersion > 0 ? recipePhotoUrl(recipe.id, recipe.photoVersion) : null)

  return (
    <Dialog title={recipe ? 'Edit recipe' : 'New recipe'} onClose={onClose} wide>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
          <div className="field">
            <label>Photo (optional)</label>
            <div className="relative h-[150px] overflow-hidden rounded-[14px] border-2 border-dashed border-control bg-bg">
              {shownPhoto ? (
                <img src={shownPhoto} alt="Recipe photo preview" className="h-full w-full object-cover" />
              ) : (
                <button type="button" className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 text-center text-[13px] text-text/70" onClick={picker.choose}>
                  <span className="text-accent-200">
                    <RecipeIcon size={24}>{CAMERA}</RecipeIcon>
                  </span>
                  <span>
                    <strong className="text-accent-200">Add a photo</strong>
                    <br />
                    JPEG, PNG or WebP
                  </span>
                </button>
              )}
            </div>
            {shownPhoto && (
              <div className="mt-1.5 flex gap-1">
                <button type="button" className="btn btn-secondary btn-sm" onClick={picker.choose}>
                  Change
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setPhoto(null)
                    setRemovePhoto(true)
                  }}
                >
                  Remove
                </button>
              </div>
            )}
            {picker.ui}
          </div>

          <div className="grid content-start gap-3">
            <div className="field">
              <label htmlFor="recipe-name">Name</label>
              <input id="recipe-name" className="input" value={name} maxLength={NAME_MAX} placeholder="e.g. Kimchi fried rice" onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="recipe-description">Description (optional)</label>
              <textarea
                id="recipe-description"
                className="input leading-snug"
                rows={3}
                maxLength={DESCRIPTION_MAX}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="field">
          <label>Items · {rows.length}</label>
          <div className="rounded-[14px] border border-divider">
            {rows.map((row) => (
              <div key={row.key} className="flex items-center gap-2 border-b border-divider py-1.5 pr-1.5 pl-3.5">
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{row.itemName}</span>
                <span className="tag tag-neutral hidden shrink-0 sm:inline-flex">{row.categoryName}</span>
                <input
                  className="input !min-h-10 !w-28 shrink-0 !py-1.5 text-sm"
                  aria-label={`Amount of ${row.itemName} (optional)`}
                  placeholder="Amount"
                  maxLength={40}
                  value={row.amount}
                  onChange={(e) => setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, amount: e.target.value } : r)))}
                />
                <button type="button" className="btn btn-ghost btn-icon text-text/60" aria-label={`Remove ${row.itemName}`} onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}>
                  <RecipeIcon size={16}>{CLOSE}</RecipeIcon>
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 p-2.5">
              <Combobox
                wrapperClassName="min-w-0 flex-1 basis-48"
                className="input"
                aria-label="Add an item"
                placeholder="Add an item…"
                value={draft}
                options={options}
                onChange={setDraft}
                onSelect={(o) => addDraft(o.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addDraft()
                  }
                }}
              />
              {draft.trim() && !known && (
                <select className="input !w-auto" aria-label="Category for the new item" value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)}>
                  {categories?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn btn-secondary" disabled={!draft.trim()} onClick={() => addDraft()}>
                Add
              </button>
            </div>
          </div>
          {draft.trim() && !known && <p className="m-0 mt-1 text-xs text-text/60">“{draft.trim()}” isn't in your items yet — it will be added.</p>}
        </div>

        {error && (
          <p role="alert" className="m-0 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save recipe'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

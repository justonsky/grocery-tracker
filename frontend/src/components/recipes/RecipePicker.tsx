import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Recipe } from '../../api/types'
import { recipePhotoUrl } from '../../recipes'
import { Dialog } from '../ui/Dialog'

// "+ Add recipe" on a trip: choose a meal, and its items join the list (those already on it aren't
// added twice) at the store picked here. It starts on the store last picked on this trip, else the
// trip's first store — never "any store" when the trip has stores: an unassigned line's price is
// credited to the first store anyway (ItemHistoryService), and it shops in a section of its own.
// A meal already planned can be topped up with any items missing.
export function RecipePicker({
  recipes,
  planned,
  stores,
  lastStore,
  onPick,
  onClose,
}: {
  recipes: Recipe[] | undefined
  planned: Set<string>
  stores: string[]
  // The store picked the last time the picker was used on this trip (undefined = not used yet).
  lastStore?: string | null
  onPick: (recipe: Recipe, storeName: string | null) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [storeName, setStoreName] = useState<string | null>(() => {
    if (lastStore === null) return null
    // Store names match ignoring case, as everywhere in the editor; the option uses the trip's spelling.
    const last = lastStore && stores.find((s) => s.toLowerCase() === lastStore.toLowerCase())
    return last || (stores[0] ?? null)
  })
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (recipes ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || r.items.some((i) => i.itemName.toLowerCase().includes(q)))
  }, [recipes, query])

  return (
    <Dialog title="Add items from a recipe" onClose={onClose}>
      <p className="m-0 text-sm text-text/70">Its items are added to the list; anything already on it isn't added twice.</p>
      {stores.length > 0 && (
        <div className="field">
          <label htmlFor="recipe-picker-store">Add items at</label>
          <select id="recipe-picker-store" className="input" value={storeName ?? ''} onChange={(e) => setStoreName(e.target.value || null)}>
            <option value="">Any store</option>
            {stores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}
      <input className="input" type="search" aria-label="Search recipes" placeholder="Search recipes or ingredients" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <ul className="m-0 grid max-h-[50dvh] list-none gap-1.5 overflow-y-auto p-0">
        {shown.map((recipe) => (
          <li key={recipe.id} className="flex items-center gap-3 rounded-[12px] p-1.5">
            <span
              aria-hidden="true"
              className="h-11 w-11 shrink-0 rounded-[10px] bg-accent-800 bg-cover bg-center"
              style={recipe.photoVersion > 0 ? { backgroundImage: `url(${recipePhotoUrl(recipe.id, recipe.photoVersion)})` } : undefined}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{recipe.name}</span>
              <span className="block text-xs text-text/60">
                {planned.has(recipe.id) ? 'Already planned' : `${recipe.items.length} ${recipe.items.length === 1 ? 'item' : 'items'}`}
              </span>
            </span>
            <button type="button" className="btn btn-secondary btn-sm min-h-11" onClick={() => onPick(recipe, storeName)}>
              {planned.has(recipe.id) ? 'Add missing' : 'Add'}
            </button>
          </li>
        ))}
        {recipes && recipes.length === 0 && (
          <li className="py-3 text-center text-sm text-text/70">
            No recipes yet. <Link to="/recipes">Create one</Link>.
          </li>
        )}
        {recipes && recipes.length > 0 && shown.length === 0 && <li className="py-3 text-center text-sm text-text/70">No recipes match.</li>}
        {!recipes && <li className="py-3 text-center text-sm text-text/70">Recipes aren't available offline until they've been loaded once.</li>}
      </ul>
      <div className="flex justify-end">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  )
}

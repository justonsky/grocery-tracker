import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Recipe } from '../../api/types'
import { recipePhotoUrl } from '../../recipes'
import { Dialog } from '../ui/Dialog'

// "+ Add recipe" on a trip: choose a meal, and its items join the list (those already on
// it aren't added twice). A meal already planned can be topped up with any items missing.
export function RecipePicker({
  recipes,
  planned,
  storeName,
  onPick,
  onClose,
}: {
  recipes: Recipe[] | undefined
  planned: Set<string>
  storeName: string | null
  onPick: (recipe: Recipe) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (recipes ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || r.items.some((i) => i.itemName.toLowerCase().includes(q)))
  }, [recipes, query])

  return (
    <Dialog title="Add a recipe" onClose={onClose}>
      <p className="m-0 text-sm text-text/70">
        Its items are added{storeName ? ` at ${storeName}` : ''}; anything already on the list isn't added twice.
      </p>
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
            <button type="button" className="btn btn-secondary btn-sm min-h-11" onClick={() => onPick(recipe)}>
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

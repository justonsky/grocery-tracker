import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Recipe } from '../api/types'
import { useConnectivity } from '../app/ConnectivityProvider'
import { RecipeDialog } from '../components/recipes/RecipeDialog'
import { RecipeForm } from '../components/recipes/RecipeForm'
import { BOWL, RecipeIcon } from '../components/recipes/icons'
import { recipePhotoUrl, useRecipes } from '../recipes'

const DESCRIPTION_PREVIEW = 100
const preview = (text: string) => (text.length > DESCRIPTION_PREVIEW ? `${text.slice(0, DESCRIPTION_PREVIEW).trimEnd()}…` : text)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// One card per recipe. With a photo, the picture is the card and a thin bar carries the
// name; on hover (or keyboard focus) the bar grows to show the first 100 characters of the
// description. Without one, the card is the title, and hovering adds the description.
function RecipeCard({ recipe, onOpen }: { recipe: Recipe; onOpen: () => void }) {
  const description = recipe.description ? preview(recipe.description) : null
  if (recipe.photoVersion > 0) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={recipe.name}
        className="group/recipe card elev-sm relative aspect-[4/3] cursor-pointer overflow-hidden border-0 bg-chip p-0 text-left"
      >
        <img src={recipePhotoUrl(recipe.id, recipe.photoVersion)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover/recipe:scale-[1.03]" />
        <span className="absolute inset-x-0 bottom-0 grid bg-neutral-950/80 px-4 py-2.5 text-white transition-[padding] duration-200 group-hover/recipe:pt-3.5 group-hover/recipe:pb-4 group-focus-visible/recipe:pt-3.5 group-focus-visible/recipe:pb-4">
          <span className="font-heading text-[16px] leading-tight font-bold">{recipe.name}</span>
          {description && (
            <span className="max-h-0 overflow-hidden text-[13px] leading-snug text-white/85 opacity-0 transition-all duration-200 group-hover/recipe:mt-1.5 group-hover/recipe:max-h-24 group-hover/recipe:opacity-100 group-focus-visible/recipe:mt-1.5 group-focus-visible/recipe:max-h-24 group-focus-visible/recipe:opacity-100">
              {description}
            </span>
          )}
        </span>
      </button>
    )
  }
  return (
    <button type="button" onClick={onOpen} aria-label={recipe.name} className="group/recipe card elev-sm relative aspect-[4/3] cursor-pointer content-between gap-2 border border-divider bg-surface p-4 text-left">
      <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-accent-800 text-accent-200">
        <RecipeIcon size={20}>{BOWL}</RecipeIcon>
      </span>
      <span className="grid gap-1">
        <span className="font-heading text-[19px] leading-tight font-bold">{recipe.name}</span>
        {description && (
          <span className="max-h-0 overflow-hidden text-[13px] leading-snug text-text/80 opacity-0 transition-all duration-200 group-hover/recipe:max-h-24 group-hover/recipe:opacity-100 group-focus-visible/recipe:max-h-24 group-focus-visible/recipe:opacity-100">
            {description}
          </span>
        )}
        <span className="text-xs text-text/60">{plural(recipe.items.length, 'item')}</span>
      </span>
    </button>
  )
}

export function Recipes() {
  const { data: recipes, isLoading, isError } = useRecipes()
  const { status } = useConnectivity()
  const online = status === 'online'
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(params.get('open'))
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return recipes ?? []
    return (recipes ?? []).filter(
      (r) => r.name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q) || r.items.some((i) => i.itemName.toLowerCase().includes(q)),
    )
  }, [recipes, query])
  const open = recipes?.find((r) => r.id === openId)

  const close = () => {
    setOpenId(null)
    if (params.has('open')) setParams({}, { replace: true })
  }

  return (
    <div className="mx-auto grid max-w-[1100px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-6 pb-15 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[30px] leading-tight sm:text-[40px]">Recipes</h1>
          <p className="m-0 mt-1 text-sm text-text/70">
            Shared with everyone in the house{recipes ? ` · ${plural(recipes.length, 'recipe')}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5 max-sm:w-full">
          <input
            type="search"
            className="input min-w-0 flex-1 sm:w-72 sm:flex-none"
            aria-label="Search recipes"
            placeholder="Search recipes or ingredients"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="btn btn-primary" disabled={!online} title={online ? undefined : 'Reconnect to your home server to add recipes.'} onClick={() => setEditing('new')}>
            + New recipe
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] sm:gap-4" aria-busy="true" aria-label="Loading recipes">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skel aspect-[4/3]" />
          ))}
        </div>
      ) : isError && !recipes ? (
        <div className="card elev-sm items-center gap-2 px-6 py-8 text-center text-text/70">Couldn't load the recipes. They need your home server — check you're connected.</div>
      ) : recipes && recipes.length === 0 ? (
        <section className="card elev-sm items-center gap-3 px-8 py-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-accent-800 text-accent-200">
            <RecipeIcon size={24}>{BOWL}</RecipeIcon>
          </span>
          <h2 className="m-0 text-[22px]">No recipes yet</h2>
          <p className="m-0 max-w-[420px] text-sm text-text/70">Save the meals you cook as lists of the items you buy, then put a whole meal on a shopping list in one tap.</p>
          <button type="button" className="btn btn-primary" disabled={!online} onClick={() => setEditing('new')}>
            Add your first recipe
          </button>
        </section>
      ) : shown.length === 0 ? (
        <p className="m-0 py-6 text-center text-text/70">No recipes match “{query.trim()}”.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] sm:gap-4">
          {shown.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} onOpen={() => setOpenId(recipe.id)} />
          ))}
        </div>
      )}

      {open && !editing && <RecipeDialog recipe={open} onClose={close} onEdit={() => setEditing(open)} />}
      {editing && (
        <RecipeForm
          recipe={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null)
            setOpenId(saved.id)
          }}
        />
      )}
    </div>
  )
}

import { forwardRef } from 'react'
import type { Recipe } from '../../api/types'
import { recipePhotoUrl } from '../../recipes'

// The text "Copy" puts on the clipboard: name, description, then the item list.
export function recipeToText(recipe: Recipe): string {
  const items = recipe.items.map((i) => `- ${i.itemName}${i.amount ? ` (${i.amount})` : ''}`).join('\n')
  const description = recipe.description?.trim()
  return [recipe.name, description, `Items (${recipe.items.length}):\n${items}`].filter(Boolean).join('\n\n')
}

// The exported picture. A fixed width, so the PNG doesn't depend on the window; the
// photo (if any) runs across the top.
export const RecipeShareCard = forwardRef<HTMLDivElement, { recipe: Recipe }>(function RecipeShareCard({ recipe }, ref) {
  return (
    <div
      ref={ref}
      className="grid overflow-hidden bg-surface text-text"
      style={{ width: 420, borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', fontFamily: 'var(--font-body)' }}
    >
      {recipe.photoVersion > 0 && (
        <img src={recipePhotoUrl(recipe.id, recipe.photoVersion)} alt="" style={{ width: 420, height: 240, objectFit: 'cover' }} crossOrigin="anonymous" />
      )}
      <div className="grid gap-3" style={{ padding: 24 }}>
        <div>
          <div className="card-kicker">Recipe</div>
          <h3 className="my-0.5">{recipe.name}</h3>
        </div>
        {recipe.description && <p className="m-0 text-sm leading-relaxed text-text/80">{recipe.description}</p>}
        <ul className="m-0 grid list-none gap-1.5 p-0 text-sm" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 14 }}>
          {recipe.items.map((item) => (
            <li key={item.itemId} className="flex items-baseline gap-2">
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 translate-y-[-2px] rounded-full bg-accent" />
              <span className="min-w-0">
                {item.itemName}
                {item.amount && <span className="text-text/60"> · {item.amount}</span>}
              </span>
            </li>
          ))}
        </ul>
        <div className="hr" style={{ margin: 0 }} />
        <div className="flex justify-between text-xs text-text/60">
          <span>
            {recipe.items.length} {recipe.items.length === 1 ? 'item' : 'items'}
          </span>
          <span>Grocery Tracker</span>
        </div>
      </div>
    </div>
  )
})

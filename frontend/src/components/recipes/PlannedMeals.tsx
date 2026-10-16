import { recipePhotoUrl } from '../../recipes'
import { CLOSE, RecipeIcon } from './icons'

// The trip's "Planned meals": one row per recipe, its photo (if any) dimmed behind the name.
// Removing a meal also removes its unbought items (the editor does that; see lineKeysToDrop).
export function PlannedMeals({
  meals,
  onRemove,
}: {
  meals: { id: string; name: string; photoVersion: number; itemCount: number }[]
  onRemove: (id: string) => void
}) {
  if (meals.length === 0) return null
  const items = meals.reduce((sum, m) => sum + m.itemCount, 0)
  return (
    <section aria-labelledby="planned-meals" className="card elev-sm gap-2.5 border border-divider p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h4 id="planned-meals" className="m-0 text-lg">
          Planned meals
        </h4>
        <span className="text-[13px] text-text/70">
          {meals.length} {meals.length === 1 ? 'recipe' : 'recipes'} · {items} {items === 1 ? 'item' : 'items'}
        </span>
      </div>
      <ul className="m-0 grid list-none gap-2 p-0">
        {meals.map((meal) => {
          const photo = meal.photoVersion > 0
          return (
            <li
              key={meal.id}
              className={`relative flex min-h-16 items-center gap-3 overflow-hidden rounded-[14px] py-1.5 pr-1.5 pl-4 ${photo ? 'bg-neutral-800 bg-cover bg-center text-white' : 'bg-chip text-text'}`}
              style={photo ? { backgroundImage: `url(${recipePhotoUrl(meal.id, meal.photoVersion)})` } : undefined}
            >
              {photo && <span aria-hidden="true" className="absolute inset-0 bg-neutral-950/55" />}
              <span className="relative min-w-0 flex-1">
                <span className="block truncate font-heading text-base font-bold">{meal.name}</span>
                <span className={`block text-xs ${photo ? 'text-white/85' : 'text-text/70'}`}>
                  {meal.itemCount} {meal.itemCount === 1 ? 'item' : 'items'}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-icon relative shrink-0 bg-surface/90 text-text"
                aria-label={`Remove ${meal.name} from planned meals`}
                onClick={() => onRemove(meal.id)}
              >
                <RecipeIcon size={16}>{CLOSE}</RecipeIcon>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

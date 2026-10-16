import { useQuery } from '@tanstack/react-query'
import { api } from './api/client'
import type { Recipe } from './api/types'

const normalize = (name: string) => name.trim().toLowerCase()

// What the server accepts for a recipe photo (RecipeLimits.cs). A larger photo has to be
// cropped in the app first, which always produces a file inside these limits.
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const PHOTO_MAX_SIDE = 1600
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// ?v= is the recipe's photo version: a new photo is a new URL, so the old one can be cached for good.
export const recipePhotoUrl = (id: string, version: number) => `/api/v1/recipes/${id}/photo?v=${version}`

export function useRecipes() {
  return useQuery({ queryKey: ['recipes'], queryFn: api.recipes.list })
}

export interface PhotoInfo {
  width: number
  height: number
  // Why it must be cropped first; null = fine as it is.
  tooLarge: string | null
}

export function loadImage(source: Blob): Promise<{ image: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(source)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ image, url })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('unreadable image'))
    }
    image.src = url
  })
}

// Reads a picked file's size and says whether it fits the limits. Throws for a file the
// browser can't read as an image.
export async function inspectPhoto(file: File): Promise<PhotoInfo> {
  const { image, url } = await loadImage(file)
  URL.revokeObjectURL(url)
  const { naturalWidth: width, naturalHeight: height } = image
  const reasons: string[] = []
  if (width > PHOTO_MAX_SIDE || height > PHOTO_MAX_SIDE) reasons.push(`${width}×${height}px is larger than ${PHOTO_MAX_SIDE}×${PHOTO_MAX_SIDE}px`)
  if (file.size > PHOTO_MAX_BYTES) reasons.push(`${(file.size / 1024 / 1024).toFixed(1)} MB is larger than ${PHOTO_MAX_BYTES / 1024 / 1024} MB`)
  if (!PHOTO_TYPES.includes(file.type)) reasons.push('it needs to be a JPEG, PNG or WebP')
  return { width, height, tooLarge: reasons.length ? `This photo is too large to use as it is: ${reasons.join(' and ')}.` : null }
}

// A recipe's lines for a trip: items not already on the trip, in the recipe's order.
export function itemsToAdd(recipe: Recipe, existing: { itemName: string }[]) {
  const have = new Set(existing.map((l) => normalize(l.itemName)))
  return recipe.items.filter((i) => !have.has(normalize(i.itemName)))
}

// Which of a trip's lines go when `removed` is taken off the plan: its items that aren't
// bought yet (not ticked, no price) and that no other planned meal needs.
export function lineKeysToDrop<T extends { itemName: string; checked: boolean; price: string }>(
  removed: Recipe | undefined,
  stillPlanned: Recipe[],
  lines: T[],
): Set<T> {
  if (!removed) return new Set()
  const needed = new Set(stillPlanned.flatMap((r) => r.items.map((i) => normalize(i.itemName))))
  const mine = new Set(removed.items.map((i) => normalize(i.itemName)))
  return new Set(lines.filter((l) => mine.has(normalize(l.itemName)) && !needed.has(normalize(l.itemName)) && !l.checked && !l.price.trim()))
}

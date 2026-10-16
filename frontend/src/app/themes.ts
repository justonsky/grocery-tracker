import { useEffect } from 'react'
import type { ChartScheme } from '../api/types'

// Per-profile color themes. Only ids and display names live here; the colors
// themselves are in index.css, where each theme is a hue + chroma pair that the
// shared palette rules expand into full light and dark accent scales. Light/dark
// stays a household setting (see useTheme) — a theme only changes the hue.
export const DEFAULT_THEME = 'fresh'

export const THEMES = [
  { id: 'fresh', name: 'Market Fresh' },
  { id: 'nocturne', name: 'Nocturne' },
  { id: 'iris', name: 'Iris' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'lagoon', name: 'Lagoon' },
  { id: 'teal', name: 'Teal' },
  { id: 'mint', name: 'Mint' },
  { id: 'forest', name: 'Forest' },
  { id: 'sage', name: 'Sage' },
  { id: 'olive', name: 'Olive' },
  { id: 'honey', name: 'Honey' },
  { id: 'amber', name: 'Amber' },
  { id: 'tangerine', name: 'Tangerine' },
  { id: 'terracotta', name: 'Terracotta' },
  { id: 'coral', name: 'Coral' },
  { id: 'ruby', name: 'Ruby' },
  { id: 'rose', name: 'Rose' },
  { id: 'magenta', name: 'Magenta' },
  { id: 'orchid', name: 'Orchid' },
  { id: 'slate', name: 'Slate' },
  { id: 'cocoa', name: 'Cocoa' },
  { id: 'mono', name: 'Mono' },
] as const

// Chart palettes (household-wide, see useTheme). "fresh" is the default: the
// Market Fresh teal-led set, or the profile theme's own accent on other themes.
export const CHART_SCHEMES: { id: ChartScheme; name: string }[] = [
  { id: 'fresh', name: 'Fresh' },
  { id: 'citrus', name: 'Citrus' },
  { id: 'berry', name: 'Berry' },
]

// A theme id from the server that this build doesn't know (renamed, or set by a
// newer build) falls back to the default rather than rendering with no palette.
export function themeOf(id: string | null | undefined): string {
  return THEMES.some((t) => t.id === id) ? id! : DEFAULT_THEME
}

// Applies a theme to the whole page via data-theme on <html>.
export function useDocumentTheme(id: string | null | undefined) {
  const theme = themeOf(id)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
}

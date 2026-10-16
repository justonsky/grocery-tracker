import type { ReactNode } from 'react'

// Stroke icons on a 24px grid, drawn in currentColor. Decorative: every button using one has a label.
export function RecipeIcon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {children}
    </svg>
  )
}

export const PENCIL = <path d="M4 20h4L19 9l-4-4L4 16z" />
export const CAMERA = (
  <>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </>
)
export const SHARE = (
  <>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M5 13v6h14v-6" />
  </>
)
export const TRASH = <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
export const CLOSE = <path d="M6 6l12 12M18 6L6 18" />
export const BOWL = (
  <>
    <path d="M4 11h16a8 8 0 0 1-16 0z" />
    <path d="M8 7c0-1 1-1.5 1-2.5M12 7c0-1 1-1.5 1-2.5M16 7c0-1 1-1.5 1-2.5" />
  </>
)
export const IMAGE = (
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="11" r="2" />
    <path d="M21 17l-5-5-8 7" />
  </>
)
export const COPY = (
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </>
)
export const BAG = <path d="M5 8h14l-1.5 11h-11zM9 8a3 3 0 0 1 6 0" />
